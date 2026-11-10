using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CausalOTel.InventoryService.Services;

public class ReservationExpiryWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ReservationExpiryWorker> _logger;

    public ReservationExpiryWorker(IServiceProvider serviceProvider, ILogger<ReservationExpiryWorker> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
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

    private async Task ExpireStaleReservationsAsync()
    {
        using var scope = _serviceProvider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var expiredReservations = await context.StockReservations
            .Where(r => r.Status == "RESERVED" && r.ExpiresAt < now)
            .ToListAsync();

        if (!expiredReservations.Any()) return;

        using var transaction = await context.Database.BeginTransactionAsync();
        try
        {
            foreach (var res in expiredReservations)
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

            await context.SaveChangesAsync();
            await transaction.CommitAsync();
            _logger.LogInformation("Expired {Count} stale inventory reservations", expiredReservations.Count);
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Failed to roll back expired reservations");
        }
    }
}
