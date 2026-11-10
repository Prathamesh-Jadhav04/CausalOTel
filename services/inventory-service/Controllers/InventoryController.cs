using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Data;
using CausalOTel.InventoryService.Models;
using CausalOTel.InventoryService.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CausalOTel.InventoryService.Controllers;

public record ReserveItemDto(string Sku, int Quantity);
public record ReserveRequest(string OrderId, List<ReserveItemDto> Items);
public record CommitRequest(string OrderId);
public record ReleaseRequest(string OrderId, string? Reason);
public record FaultRequest(int LatencyMs, bool SimulateBusy, bool SimulateError, string? ErrorMessage);

[ApiController]
[Route("api/inventory")]
public class InventoryController : ControllerBase
{
    private readonly InventoryDbContext _context;
    private readonly InventoryFaultState _faultState;
    private readonly ILogger<InventoryController> _logger;

    public InventoryController(InventoryDbContext context, InventoryFaultState faultState, ILogger<InventoryController> logger)
    {
        _context = context;
        _faultState = faultState;
        _logger = logger;
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
            return NotFound(new ProblemDetails
            {
                Type = "https://causalotel.io/errors/404",
                Title = "Stock Item Not Found",
                Status = 404,
                Detail = $"No inventory record found for SKU: {sku}"
            });
        }
        return Ok(item);
    }

    [HttpPost("reserve")]
    public async Task<IActionResult> Reserve([FromBody] ReserveRequest request)
    {
        await ApplySimulatedFaultAsync();

        if (string.IsNullOrWhiteSpace(request?.OrderId))
        {
            return BadRequest(new ProblemDetails
            {
                Type = "https://causalotel.io/errors/400",
                Title = "Invalid Order ID",
                Status = 400,
                Detail = "OrderId must not be empty"
            });
        }

        if (request.Items == null || !request.Items.Any())
        {
            return BadRequest(new ProblemDetails
            {
                Type = "https://causalotel.io/errors/400",
                Title = "Empty Reservation Request",
                Status = 400,
                Detail = "Reservation items list cannot be empty"
            });
        }

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // 1. Idempotency Check: if reservations already exist for this orderId, return existing
        var existingReservations = await _context.StockReservations
            .Where(r => r.OrderId == request.OrderId)
            .AsNoTracking()
            .ToListAsync();

        if (existingReservations.Any())
        {
            var active = existingReservations.Where(r => r.Status == "RESERVED" || r.Status == "COMMITTED").ToList();
            if (active.Any())
            {
                return Ok(new
                {
                    status = active.First().Status,
                    orderId = request.OrderId,
                    reservations = active,
                    idempotent = true
                });
            }
        }

        // 2. Perform atomic reservation in a transaction
        using var transaction = await _context.Database.BeginTransactionAsync();
        try
        {
            var createdReservations = new List<StockReservation>();
            long expiresAt = now + (5 * 60 * 1000); // 5 minutes TTL

            foreach (var item in request.Items)
            {
                if (item.Quantity <= 0)
                {
                    await transaction.RollbackAsync();
                    return BadRequest(new ProblemDetails
                    {
                        Type = "https://causalotel.io/errors/400",
                        Title = "Invalid Quantity",
                        Status = 400,
                        Detail = $"Quantity for SKU {item.Sku} must be positive"
                    });
                }

                // Atomic conditional decrement in SQL - guarantees concurrency safety
                int rows = await _context.Database.ExecuteSqlRawAsync(
                    "UPDATE stock_items SET AvailableQuantity = AvailableQuantity - {0}, ReservedQuantity = ReservedQuantity + {0}, UpdatedAt = {1} WHERE Sku = {2} AND AvailableQuantity >= {0}",
                    item.Quantity, now, item.Sku);

                if (rows == 0)
                {
                    await transaction.RollbackAsync();
                    return Conflict(new ProblemDetails
                    {
                        Type = "https://causalotel.io/errors/409",
                        Title = "Insufficient Stock",
                        Status = 409,
                        Detail = $"Insufficient inventory available for SKU: {item.Sku}"
                    });
                }

                var reservation = new StockReservation
                {
                    Id = Guid.NewGuid().ToString("N"),
                    OrderId = request.OrderId,
                    Sku = item.Sku,
                    Quantity = item.Quantity,
                    Status = "RESERVED",
                    ExpiresAt = expiresAt,
                    CreatedAt = now,
                    UpdatedAt = now
                };

                _context.StockReservations.Add(reservation);
                createdReservations.Add(reservation);
            }

            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return Ok(new
            {
                status = "RESERVED",
                orderId = request.OrderId,
                reservations = createdReservations
            });
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Transaction failed while reserving inventory for Order {OrderId}", request.OrderId);
            throw;
        }
    }

    [HttpPost("commit")]
    public async Task<IActionResult> Commit([FromBody] CommitRequest request)
    {
        await ApplySimulatedFaultAsync();

        if (string.IsNullOrWhiteSpace(request?.OrderId))
        {
            return BadRequest(new ProblemDetails
            {
                Type = "https://causalotel.io/errors/400",
                Title = "Invalid Order ID",
                Status = 400,
                Detail = "OrderId must not be empty"
            });
        }

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var reservations = await _context.StockReservations
            .Where(r => r.OrderId == request.OrderId)
            .ToListAsync();

        if (!reservations.Any())
        {
            return NotFound(new ProblemDetails
            {
                Type = "https://causalotel.io/errors/404",
                Title = "Reservation Not Found",
                Status = 404,
                Detail = $"No reservations found for orderId: {request.OrderId}"
            });
        }

        // Idempotency: If all already COMMITTED, return OK
        if (reservations.All(r => r.Status == "COMMITTED"))
        {
            return Ok(new { status = "COMMITTED", orderId = request.OrderId, idempotent = true });
        }

        // Check if already RELEASED
        if (reservations.Any(r => r.Status == "RELEASED"))
        {
            return Conflict(new ProblemDetails
            {
                Type = "https://causalotel.io/errors/409",
                Title = "Reservation Not Active",
                Status = 409,
                Detail = $"Reservation for orderId {request.OrderId} has already been released"
            });
        }

        // If EXPIRED, coordinate recovery with current stock state
        if (reservations.Any(r => r.Status == "EXPIRED"))
        {
            using var recoverTx = await _context.Database.BeginTransactionAsync();
            try
            {
                bool canRecover = true;
                foreach (var res in reservations.Where(r => r.Status == "EXPIRED"))
                {
                    int rows = await _context.Database.ExecuteSqlRawAsync(
                        "UPDATE stock_items SET AvailableQuantity = AvailableQuantity - {0}, UpdatedAt = {1} WHERE Sku = {2} AND AvailableQuantity >= {0}",
                        res.Quantity, now, res.Sku);
                    if (rows == 0)
                    {
                        canRecover = false;
                        break;
                    }
                }

                if (canRecover)
                {
                    foreach (var res in reservations)
                    {
                        res.Status = "COMMITTED";
                        res.UpdatedAt = now;
                    }
                    await _context.SaveChangesAsync();
                    await recoverTx.CommitAsync();
                    _logger.LogInformation("Recovered and committed expired reservation for orderId {OrderId}", request.OrderId);
                    return Ok(new { status = "COMMITTED", orderId = request.OrderId, recovered = true });
                }
                else
                {
                    await recoverTx.RollbackAsync();
                    return Conflict(new ProblemDetails
                    {
                        Type = "https://causalotel.io/errors/409",
                        Title = "Reservation Expired",
                        Status = 409,
                        Detail = $"Reservation for orderId {request.OrderId} has expired and stock is no longer available"
                    });
                }
            }
            catch (Exception)
            {
                await recoverTx.RollbackAsync();
                throw;
            }
        }

        using var transaction = await _context.Database.BeginTransactionAsync();
        try
        {
            foreach (var res in reservations.Where(r => r.Status == "RESERVED"))
            {
                var stock = await _context.StockItems.FirstOrDefaultAsync(s => s.Sku == res.Sku);
                if (stock != null)
                {
                    stock.ReservedQuantity = Math.Max(0, stock.ReservedQuantity - res.Quantity);
                    stock.UpdatedAt = now;
                }
                res.Status = "COMMITTED";
                res.UpdatedAt = now;
            }

            await _context.SaveChangesAsync();
            await transaction.CommitAsync();

            return Ok(new { status = "COMMITTED", orderId = request.OrderId });
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Transaction failed while committing inventory for Order {OrderId}", request.OrderId);
            throw;
        }
    }

    [HttpPost("release")]
    public async Task<IActionResult> Release([FromBody] ReleaseRequest request)
    {
        await ApplySimulatedFaultAsync();

        if (string.IsNullOrWhiteSpace(request?.OrderId))
        {
            return BadRequest(new ProblemDetails
            {
                Type = "https://causalotel.io/errors/400",
                Title = "Invalid Order ID",
                Status = 400,
                Detail = "OrderId must not be empty"
            });
        }

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var reservations = await _context.StockReservations
            .Where(r => r.OrderId == request.OrderId)
            .ToListAsync();

        if (!reservations.Any())
        {
            return Ok(new { status = "NOOP", orderId = request.OrderId, detail = "No reservations found to release" });
        }

        // Idempotency: If already RELEASED or EXPIRED
        if (reservations.All(r => r.Status == "RELEASED" || r.Status == "EXPIRED"))
        {
            return Ok(new { status = "RELEASED", orderId = request.OrderId, idempotent = true });
        }

        using var transaction = await _context.Database.BeginTransactionAsync();
        try
        {
            foreach (var res in reservations.Where(r => r.Status == "RESERVED"))
            {
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
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Transaction failed while releasing inventory for Order {OrderId}", request.OrderId);
            throw;
        }
    }

    [HttpPost("fault")]
    public IActionResult SetFault([FromBody] FaultRequest request)
    {
        _faultState.LatencyMs = request.LatencyMs;
        _faultState.SimulateBusy = request.SimulateBusy;
        _faultState.SimulateError = request.SimulateError;
        _faultState.ErrorMessage = request.ErrorMessage;
        return Ok(new { status = "UPDATED", fault = _faultState });
    }

    [HttpGet("fault")]
    public IActionResult GetFault()
    {
        return Ok(_faultState);
    }
}
