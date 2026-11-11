using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Data;
using CausalOTel.InventoryService.Models;
using CausalOTel.InventoryService.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace CausalOTel.InventoryService.Controllers;

public record ReserveItemDto(string Sku, int Quantity);
public record ReserveRequest(string OrderId, List<ReserveItemDto> Items);
public record CommitRequest(string OrderId);
public record ReleaseRequest(string OrderId, string? Reason);
public record FaultRequest(int LatencyMs, bool SimulateBusy, bool SimulateError, string? ErrorMessage);

[ApiController]
[Route("api/inventory")]
[Authorize]
public class InventoryController : ControllerBase
{
    private const int MaxFaultLatencyMs = 10_000;
    private const int MaxErrorMessageLength = 500;
    private static readonly IReadOnlyDictionary<string, HashSet<string>> AllowedTransitions =
        new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase)
        {
            ["PENDING"] = new(StringComparer.OrdinalIgnoreCase) { "RESERVED" },
            ["RESERVED"] = new(StringComparer.OrdinalIgnoreCase) { "COMMITTED", "RELEASED", "EXPIRED" },
            ["EXPIRED"] = new(StringComparer.OrdinalIgnoreCase) { "COMMITTED" },
            ["COMMITTED"] = new(StringComparer.OrdinalIgnoreCase),
            ["RELEASED"] = new(StringComparer.OrdinalIgnoreCase)
        };

    private readonly InventoryDbContext _context;
    private readonly InventoryFaultState _faultState;
    private readonly ILogger<InventoryController> _logger;
    private readonly bool _faultInjectionEnabled;

    public InventoryController(InventoryDbContext context, InventoryFaultState faultState,
        ILogger<InventoryController> logger, IConfiguration configuration)
    {
        _context = context;
        _faultState = faultState;
        _logger = logger;
        string? configured = configuration["CAUSALOTEL_FAULT_INJECTION_ENABLED"]
            ?? configuration["causalotel:fault-injection:enabled"];
        _faultInjectionEnabled = !string.Equals(configured, "false", StringComparison.OrdinalIgnoreCase);
    }

    private async Task ApplySimulatedFaultAsync()
    {
        if (_faultState.LatencyMs > 0)
        {
            await Task.Delay(_faultState.LatencyMs);
        }

        if (_faultState.SimulateBusy)
        {
            throw new InvalidOperationException("SQLite database is locked: SQLITE_BUSY (simulated)");
        }

        if (_faultState.SimulateError)
        {
            throw new InvalidOperationException(_faultState.ErrorMessage ?? "Simulated downstream internal inventory error");
        }
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<StockItem>>> GetStockItems()
    {
        await ApplySimulatedFaultAsync();
        var items = await _context.StockItems.AsNoTracking().ToListAsync();
        return Ok(items);
    }

    [HttpGet("{sku}")]
    public async Task<ActionResult<StockItem>> GetStockItem(string sku)
    {
        await ApplySimulatedFaultAsync();
        var item = await _context.StockItems.AsNoTracking().FirstOrDefaultAsync(s => s.Sku == sku);
        if (item == null)
        {
            return NotFound(Problem(404, "Stock Item Not Found", $"No inventory record found for SKU: {sku}"));
        }
        return Ok(item);
    }

    [HttpPost("reserve")]
    [Authorize(Roles = "ROLE_SERVICE,ROLE_ADMIN")]
    public async Task<IActionResult> Reserve([FromBody] ReserveRequest request)
    {
        await ApplySimulatedFaultAsync();

        if (string.IsNullOrWhiteSpace(request?.OrderId))
        {
            return BadRequest(Problem(400, "Invalid Order ID", "OrderId must not be empty"));
        }
        if (request.OrderId.Length > 64)
        {
            return BadRequest(Problem(400, "Invalid Order ID", "OrderId must be at most 64 characters"));
        }
        if (request.Items == null || !request.Items.Any())
        {
            return BadRequest(Problem(400, "Empty Reservation Request", "Reservation items list cannot be empty"));
        }

        List<ReserveItemDto> normalized;
        try
        {
            normalized = NormalizeItems(request.Items);
        }
        catch (Exception ex) when (ex is ArgumentException or OverflowException)
        {
            return BadRequest(Problem(400, "Invalid Reservation Item", ex.Message));
        }

        string requestHash = ComputeRequestHash(normalized);
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // Fast path for a sequential replay. Concurrency safety comes from the
        // unique (OrderId, Sku) index below, not from this read.
        var existing = await _context.StockReservations
            .Where(r => r.OrderId == request.OrderId)
            .AsNoTracking()
            .ToListAsync();
        if (existing.Any())
        {
            return ExistingReservationResponse(request.OrderId, existing, requestHash);
        }

        using var transaction = await _context.Database.BeginTransactionAsync();
        try
        {
            long expiresAt = now + (5 * 60 * 1000); // 5 minutes TTL
            var createdReservations = new List<StockReservation>();

            // H-04: claim the (OrderId, Sku) slots first. The unique index makes
            // exactly one concurrent request the winner; the rest observe the
            // committed winner and replay its result.
            foreach (var item in normalized)
            {
                var reservation = new StockReservation
                {
                    Id = Guid.NewGuid().ToString("N"),
                    OrderId = request.OrderId,
                    Sku = item.Sku,
                    Quantity = item.Quantity,
                    Status = "PENDING",
                    RequestHash = requestHash,
                    ExpiresAt = expiresAt,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                _context.StockReservations.Add(reservation);
                createdReservations.Add(reservation);
            }
            await _context.SaveChangesAsync();

            foreach (var item in normalized)
            {
                int rows = await _context.Database.ExecuteSqlRawAsync(
                    "UPDATE stock_items SET AvailableQuantity = AvailableQuantity - {0}, " +
                    "ReservedQuantity = ReservedQuantity + {0}, UpdatedAt = {1} " +
                    "WHERE Sku = {2} AND AvailableQuantity >= {0}",
                    item.Quantity, now, item.Sku);

                if (rows == 0)
                {
                    throw new InsufficientStockException(item.Sku);
                }
            }

            foreach (var reservation in createdReservations)
            {
                EnsureTransition(reservation.Status, "RESERVED");
                reservation.Status = "RESERVED";
                reservation.UpdatedAt = now;
            }
            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return Ok(new
            {
                status = "RESERVED",
                orderId = request.OrderId,
                requestHash,
                reservations = createdReservations
            });
        }
        catch (InsufficientStockException ex)
        {
            await transaction.RollbackAsync();
            _context.ChangeTracker.Clear();
            return Conflict(Problem(409, "Insufficient Stock",
                $"Insufficient inventory available for SKU: {ex.Sku}"));
        }
        catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
        {
            await transaction.RollbackAsync();
            _context.ChangeTracker.Clear();

            var winner = await _context.StockReservations
                .Where(r => r.OrderId == request.OrderId)
                .AsNoTracking()
                .ToListAsync();
            if (winner.Any())
            {
                return ExistingReservationResponse(request.OrderId, winner, requestHash);
            }
            return Conflict(Problem(409, "Reservation Conflict",
                "A concurrent reservation for this order could not be resolved; retry"));
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Transaction failed while reserving inventory for Order {OrderId}", request.OrderId);
            throw;
        }
    }

    [HttpPost("commit")]
    [Authorize(Roles = "ROLE_SERVICE,ROLE_ADMIN")]
    public async Task<IActionResult> Commit([FromBody] CommitRequest request)
    {
        await ApplySimulatedFaultAsync();

        if (string.IsNullOrWhiteSpace(request?.OrderId))
        {
            return BadRequest(Problem(400, "Invalid Order ID", "OrderId must not be empty"));
        }

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var reservations = await _context.StockReservations
            .Where(r => r.OrderId == request.OrderId)
            .ToListAsync();

        if (!reservations.Any())
        {
            return NotFound(Problem(404, "Reservation Not Found",
                $"No reservations found for orderId: {request.OrderId}"));
        }

        if (reservations.All(r => r.Status == "COMMITTED"))
        {
            return Ok(new { status = "COMMITTED", orderId = request.OrderId, idempotent = true });
        }
        if (reservations.Any(r => r.Status == "RELEASED"))
        {
            return Conflict(Problem(409, "Reservation Not Active",
                $"Reservation for orderId {request.OrderId} has already been released"));
        }
        if (reservations.Any(r => r.Status == "PENDING"))
        {
            return Conflict(Problem(409, "Reservation Pending",
                $"Reservation for orderId {request.OrderId} is still being created"));
        }

        using var transaction = await _context.Database.BeginTransactionAsync();
        try
        {
            foreach (var res in reservations)
            {
                if (res.Status == "EXPIRED")
                {
                    // The expiry worker already returned the stock; re-claim it
                    // atomically before committing.
                    int rows = await _context.Database.ExecuteSqlRawAsync(
                        "UPDATE stock_items SET AvailableQuantity = AvailableQuantity - {0}, UpdatedAt = {1} " +
                        "WHERE Sku = {2} AND AvailableQuantity >= {0}",
                        res.Quantity, now, res.Sku);
                    if (rows == 0)
                    {
                        throw new InsufficientStockException(res.Sku);
                    }
                }
                else if (res.Status == "RESERVED")
                {
                    var stock = await _context.StockItems.FirstOrDefaultAsync(s => s.Sku == res.Sku);
                    if (stock != null)
                    {
                        stock.ReservedQuantity = Math.Max(0, stock.ReservedQuantity - res.Quantity);
                        stock.UpdatedAt = now;
                    }
                }

                EnsureTransition(res.Status, "COMMITTED");
                res.Status = "COMMITTED";
                res.UpdatedAt = now;
            }

            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return Ok(new { status = "COMMITTED", orderId = request.OrderId });
        }
        catch (InsufficientStockException ex)
        {
            await transaction.RollbackAsync();
            _context.ChangeTracker.Clear();
            return Conflict(Problem(409, "Reservation Expired",
                $"Reservation for orderId {request.OrderId} has expired and stock is no longer available for SKU {ex.Sku}"));
        }
        catch (InvalidStateTransitionException ex)
        {
            await transaction.RollbackAsync();
            _context.ChangeTracker.Clear();
            return Conflict(Problem(409, "Invalid Reservation State", ex.Message));
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Transaction failed while committing inventory for Order {OrderId}", request.OrderId);
            throw;
        }
    }

    [HttpPost("release")]
    [Authorize(Roles = "ROLE_SERVICE,ROLE_ADMIN")]
    public async Task<IActionResult> Release([FromBody] ReleaseRequest request)
    {
        await ApplySimulatedFaultAsync();

        if (string.IsNullOrWhiteSpace(request?.OrderId))
        {
            return BadRequest(Problem(400, "Invalid Order ID", "OrderId must not be empty"));
        }

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var reservations = await _context.StockReservations
            .Where(r => r.OrderId == request.OrderId)
            .ToListAsync();

        if (!reservations.Any())
        {
            return Ok(new { status = "NOOP", orderId = request.OrderId, detail = "No reservations found to release" });
        }

        if (reservations.All(r => r.Status == "RELEASED" || r.Status == "EXPIRED"))
        {
            return Ok(new { status = "RELEASED", orderId = request.OrderId, idempotent = true });
        }
        if (reservations.Any(r => r.Status == "COMMITTED"))
        {
            return Conflict(Problem(409, "Reservation Already Committed",
                $"Committed inventory for orderId {request.OrderId} cannot be released"));
        }
        if (reservations.Any(r => r.Status == "PENDING"))
        {
            return Conflict(Problem(409, "Reservation Pending",
                $"Reservation for orderId {request.OrderId} is still being created"));
        }

        using var transaction = await _context.Database.BeginTransactionAsync();
        try
        {
            foreach (var res in reservations)
            {
                EnsureTransition(res.Status, "RELEASED");
                var stock = await _context.StockItems.FirstOrDefaultAsync(s => s.Sku == res.Sku);
                if (stock != null)
                {
                    stock.AvailableQuantity += res.Quantity;
                    stock.ReservedQuantity = Math.Max(0, stock.ReservedQuantity - res.Quantity);
                    stock.UpdatedAt = now;
                }
                res.Status = "RELEASED";
                res.UpdatedAt = now;
            }

            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return Ok(new { status = "RELEASED", orderId = request.OrderId, reason = request.Reason });
        }
        catch (InvalidStateTransitionException ex)
        {
            await transaction.RollbackAsync();
            _context.ChangeTracker.Clear();
            return Conflict(Problem(409, "Invalid Reservation State", ex.Message));
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Transaction failed while releasing inventory for Order {OrderId}", request.OrderId);
            throw;
        }
    }

    [HttpPost("fault")]
    [Authorize(Roles = "ROLE_ADMIN")]
    public IActionResult SetFault([FromBody] FaultRequest request)
    {
        if (!_faultInjectionEnabled)
        {
            return NotFound(Problem(404, "Fault Injection Disabled", "Fault injection is disabled on this instance"));
        }
        if (request == null)
        {
            return BadRequest(Problem(400, "Invalid Fault Configuration", "Fault configuration is required"));
        }
        if (request.LatencyMs < 0 || request.LatencyMs > MaxFaultLatencyMs)
        {
            return BadRequest(Problem(400, "Invalid Fault Configuration",
                $"LatencyMs must be between 0 and {MaxFaultLatencyMs}"));
        }
        if (request.ErrorMessage != null && request.ErrorMessage.Length > MaxErrorMessageLength)
        {
            return BadRequest(Problem(400, "Invalid Fault Configuration",
                $"ErrorMessage must be at most {MaxErrorMessageLength} characters"));
        }

        // H-01: validate everything before mutating state.
        _faultState.LatencyMs = request.LatencyMs;
        _faultState.SimulateBusy = request.SimulateBusy;
        _faultState.SimulateError = request.SimulateError;
        _faultState.ErrorMessage = request.ErrorMessage;

        _logger.LogInformation(
            "AUDIT fault configuration changed by user={User} role={Role}: latencyMs={LatencyMs}, busy={Busy}, error={Error}",
            User.Identity?.Name ?? "unknown",
            User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "unknown",
            _faultState.LatencyMs, _faultState.SimulateBusy, _faultState.SimulateError);

        return Ok(new { status = "UPDATED", fault = _faultState });
    }

    [HttpGet("fault")]
    [Authorize(Roles = "ROLE_ADMIN")]
    public IActionResult GetFault()
    {
        if (!_faultInjectionEnabled)
        {
            return NotFound(Problem(404, "Fault Injection Disabled", "Fault injection is disabled on this instance"));
        }
        return Ok(_faultState);
    }

    private static List<ReserveItemDto> NormalizeItems(IEnumerable<ReserveItemDto> items)
    {
        var merged = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            if (item == null)
            {
                throw new ArgumentException("Reservation item cannot be null");
            }
            if (string.IsNullOrWhiteSpace(item.Sku) || item.Sku.Length > 64)
            {
                throw new ArgumentException("SKU must be 1-64 characters");
            }
            if (item.Quantity <= 0 || item.Quantity > 1000)
            {
                throw new ArgumentException($"Quantity for SKU {item.Sku} must be between 1 and 1000");
            }

            int combined = checked(merged.TryGetValue(item.Sku, out int existing) ? existing + item.Quantity : item.Quantity);
            if (combined > 1000)
            {
                throw new ArgumentException($"Combined quantity for SKU {item.Sku} exceeds 1000");
            }
            merged[item.Sku] = combined;
        }

        return merged.Select(kv => new ReserveItemDto(kv.Key, kv.Value)).ToList();
    }

    private static string ComputeRequestHash(IEnumerable<ReserveItemDto> items)
    {
        string canonical = string.Join(",",
            items.OrderBy(i => i.Sku, StringComparer.Ordinal)
                 .Select(i => $"{i.Sku}:{i.Quantity}"));
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private IActionResult ExistingReservationResponse(string orderId,
        List<StockReservation> existing, string requestHash)
    {
        bool hashMatches = existing.All(r =>
            string.IsNullOrEmpty(r.RequestHash) ||
            string.Equals(r.RequestHash, requestHash, StringComparison.OrdinalIgnoreCase));

        if (!hashMatches)
        {
            return Conflict(Problem(409, "Reservation Payload Mismatch",
                $"Order {orderId} already has a reservation with a different item payload"));
        }

        if (existing.All(r => r.Status is "RESERVED" or "COMMITTED"))
        {
            return Ok(new
            {
                status = existing.Any(r => r.Status == "COMMITTED") ? "COMMITTED" : "RESERVED",
                orderId,
                reservations = existing,
                idempotent = true
            });
        }

        if (existing.All(r => r.Status is "RELEASED" or "EXPIRED"))
        {
            return Conflict(Problem(409, "Reservation Not Active",
                $"Reservation for orderId {orderId} is no longer active"));
        }

        return Conflict(Problem(409, "Reservation Pending",
            $"Reservation for orderId {orderId} is still being created"));
    }

    private static void EnsureTransition(string from, string to)
    {
        if (!AllowedTransitions.TryGetValue(from, out var allowed) || !allowed.Contains(to))
        {
            throw new InvalidStateTransitionException(from, to);
        }
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException ex)
    {
        string message = ex.InnerException?.Message ?? ex.Message;
        return message.Contains("UNIQUE constraint failed", StringComparison.OrdinalIgnoreCase)
            || message.Contains("ux_stock_reservations_order_sku", StringComparison.OrdinalIgnoreCase);
    }

    private static ProblemDetails Problem(int status, string title, string detail) => new()
    {
        Type = $"https://causalotel.io/errors/{status}",
        Title = title,
        Status = status,
        Detail = detail
    };

    private sealed class InsufficientStockException : Exception
    {
        public string Sku { get; }
        public InsufficientStockException(string sku) : base($"Insufficient stock for {sku}")
        {
            Sku = sku;
        }
    }

    private sealed class InvalidStateTransitionException : Exception
    {
        public InvalidStateTransitionException(string from, string to)
            : base($"Reservation state cannot transition from {from} to {to}")
        {
        }
    }
}
