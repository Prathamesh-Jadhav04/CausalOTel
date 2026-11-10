using System;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Data;
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

    public ReservationExpiryWorker(IServiceProvider serviceProvider, ILogger<ReservationExpiryWorker> logger, IConfiguration configuration)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _paymentServiceUrl = configuration["SERVICES_PAYMENT_URL"] ?? Environment.GetEnvironmentVariable("SERVICES_PAYMENT_URL") ?? "http://localhost:8084";
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
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
        try
        {
            var response = await _httpClient.GetAsync($"{_paymentServiceUrl}/api/payments/order/{orderId}");
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

    public async Task ExpireStaleReservationsAsync()
    {
        using var scope = _serviceProvider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var expiredReservations = await context.StockReservations
            .Where(r => r.Status == "RESERVED" && r.ExpiresAt < now)
            .ToListAsync();

        if (!expiredReservations.Any()) return;

        var groupedByOrder = expiredReservations.GroupBy(r => r.OrderId).ToList();

        using var transaction = await context.Database.BeginTransactionAsync();
        try
        {
            foreach (var orderGroup in groupedByOrder)
            {
                string orderId = orderGroup.Key;
                string? paymentStatus = await CheckPaymentStatusAsync(orderId);

                if (paymentStatus == "CAPTURED")
                {
                    // Payment succeeded: Never release inventory blindly! Coordinate with payment state.
                    _logger.LogInformation("Order {OrderId} reservation expired but payment is CAPTURED. Committing inventory.", orderId);
                    foreach (var res in orderGroup)
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
                    // Payment outcome unknown / payment service unreachable: do NOT release inventory blindly!
                    // Extend reservation TTL by 5 minutes to allow recovery/reconciliation.
                    _logger.LogWarning("Payment outcome unknown for order {OrderId}. Deferring reservation release.", orderId);
                    foreach (var res in orderGroup)
                    {
                        res.ExpiresAt = now + (5 * 60 * 1000);
                        res.UpdatedAt = now;
                    }
                }
                else
                {
                    // Payment definitely not found or not captured: safe to expire
                    _logger.LogInformation("Expiring stale reservation for order {OrderId}", orderId);
                    foreach (var res in orderGroup)
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
            }

            await context.SaveChangesAsync();
            await transaction.CommitAsync();
            _logger.LogInformation("Processed {Count} stale inventory reservations across {Orders} orders", expiredReservations.Count, groupedByOrder.Count);
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Failed to coordinate expired reservations");
        }
    }
}
