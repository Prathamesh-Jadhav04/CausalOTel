using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Data;
using CausalOTel.InventoryService.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CausalOTel.InventoryService.Services;

public class ReservationExpiryWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ReservationExpiryWorker> _logger;
    private readonly string _paymentServiceUrl;
    private readonly HttpClient _httpClient;
    private readonly ServiceTokenProvider _serviceTokenProvider;

    private int _transactionDepth;

    /// <summary>H-08 regression hook: must remain false.</summary>
    public bool HttpCallObservedDuringTransaction { get; private set; }

    /// <summary>H-08 regression hook: number of payment status probes.</summary>
    public int HttpCallCount { get; private set; }

    public ReservationExpiryWorker(IServiceProvider serviceProvider,
        ILogger<ReservationExpiryWorker> logger, IConfiguration configuration)
        : this(serviceProvider, logger, configuration, null)
    {
    }

    public ReservationExpiryWorker(IServiceProvider serviceProvider,
        ILogger<ReservationExpiryWorker> logger, IConfiguration configuration,
        HttpClient? httpClient)
        : this(serviceProvider, logger, configuration, httpClient, null)
    {
    }

    public ReservationExpiryWorker(IServiceProvider serviceProvider,
        ILogger<ReservationExpiryWorker> logger, IConfiguration configuration,
        HttpClient? httpClient, ServiceTokenProvider? serviceTokenProvider)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _paymentServiceUrl = configuration["SERVICES_PAYMENT_URL"]
            ?? Environment.GetEnvironmentVariable("SERVICES_PAYMENT_URL")
            ?? "http://localhost:8084";
        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        _serviceTokenProvider = serviceTokenProvider ?? new ServiceTokenProvider(configuration);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Initial delay to avoid startup contention
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ExpireStaleReservationsAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred during reservation expiry check");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<string?> CheckPaymentStatusAsync(string orderId)
    {
        HttpCallCount++;
        if (_transactionDepth > 0)
        {
            HttpCallObservedDuringTransaction = true;
            _logger.LogError("BUG: payment status HTTP call made while a database transaction is open");
        }

        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get, $"{_paymentServiceUrl}/api/payments/order/{orderId}");
            // H-02: payment reads now require a privileged credential.
            request.Headers.Authorization = new AuthenticationHeaderValue(
                "Bearer", _serviceTokenProvider.CreateServiceToken());
            var response = await _httpClient.SendAsync(request);
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return "NOT_FOUND";
            }
            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(content);
                if (doc.RootElement.TryGetProperty("status", out var statusProp))
                {
                    return statusProp.GetString();
                }
            }
            return "UNKNOWN";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not determine payment state for order {OrderId}", orderId);
            return "UNKNOWN";
        }
    }

    /// <summary>
    /// H-08: all payment HTTP calls happen before any write transaction. Each
    /// order is then applied in its own short transaction so one failure cannot
    /// roll back the rest of the batch.
    /// </summary>
    public async Task ExpireStaleReservationsAsync()
    {
        using var scope = _serviceProvider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var expiredReservations = await context.StockReservations
            .AsNoTracking()
            .Where(r => r.Status == "RESERVED" && r.ExpiresAt < now)
            .ToListAsync();

        if (!expiredReservations.Any())
        {
            return;
        }

        var groupedByOrder = expiredReservations.GroupBy(r => r.OrderId).ToList();

        // Phase 1: resolve payment state with no database write transaction open.
        var paymentDecisions = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var orderGroup in groupedByOrder)
        {
            paymentDecisions[orderGroup.Key] = await CheckPaymentStatusAsync(orderGroup.Key);
        }

        // Phase 2: apply each order in a short, independent transaction.
        int processedOrders = 0;
        foreach (var orderGroup in groupedByOrder)
        {
            string orderId = orderGroup.Key;
            string? paymentStatus = paymentDecisions[orderId];

            context.ChangeTracker.Clear();
            await using var transaction = await context.Database.BeginTransactionAsync();
            _transactionDepth++;
            try
            {
                var reservations = await context.StockReservations
                    .Where(r => r.OrderId == orderId && r.Status == "RESERVED")
                    .ToListAsync();

                if (!reservations.Any())
                {
                    await transaction.CommitAsync();
                    continue;
                }

                if (paymentStatus == "CAPTURED")
                {
                    // Payment succeeded: never release inventory blindly.
                    _logger.LogInformation(
                        "Order {OrderId} reservation expired but payment is CAPTURED. Committing inventory.", orderId);
                    foreach (var res in reservations)
                    {
                        var stock = await context.StockItems.FirstOrDefaultAsync(s => s.Sku == res.Sku);
                        if (stock != null)
                        {
                            stock.ReservedQuantity = Math.Max(0, stock.ReservedQuantity - res.Quantity);
                            stock.UpdatedAt = now;
                        }
                        res.Status = "COMMITTED";
                        res.UpdatedAt = now;
                    }
                }
                else if (paymentStatus == "UNKNOWN")
                {
                    // Payment outcome unknown / payment service unreachable:
                    // extend the TTL instead of releasing inventory blindly.
                    _logger.LogWarning(
                        "Payment outcome unknown for order {OrderId}. Deferring reservation release.", orderId);
                    foreach (var res in reservations)
                    {
                        res.ExpiresAt = now + (5 * 60 * 1000);
                        res.UpdatedAt = now;
                    }
                }
                else
                {
                    _logger.LogInformation("Expiring stale reservation for order {OrderId}", orderId);
                    foreach (var res in reservations)
                    {
                        var stock = await context.StockItems.FirstOrDefaultAsync(s => s.Sku == res.Sku);
                        if (stock != null)
                        {
                            stock.AvailableQuantity += res.Quantity;
                            stock.ReservedQuantity = Math.Max(0, stock.ReservedQuantity - res.Quantity);
                            stock.UpdatedAt = now;
                        }
                        res.Status = "EXPIRED";
                        res.UpdatedAt = now;
                    }
                }

                await context.SaveChangesAsync();
                await transaction.CommitAsync();
                processedOrders++;
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                _logger.LogError(ex, "Failed to process expired reservations for order {OrderId}", orderId);
            }
            finally
            {
                _transactionDepth--;
            }
        }

        _logger.LogInformation(
            "Processed {Count} stale inventory reservations across {Orders} orders",
            expiredReservations.Count, processedOrders);
    }
}
