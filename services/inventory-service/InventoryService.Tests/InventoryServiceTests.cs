using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Controllers;
using CausalOTel.InventoryService.Data;
using CausalOTel.InventoryService.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace CausalOTel.InventoryService.Tests;

public class InventoryServiceTests : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _testDbPath;

    public InventoryServiceTests(WebApplicationFactory<Program> factory)
    {
        _testDbPath = Path.Combine(Path.GetTempPath(), $"causalotel_inv_test_{Guid.NewGuid():N}.db");

        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("SQLITE_DB_PATH", _testDbPath);
        });
    }

    public void Dispose()
    {
        try
        {
            if (File.Exists(_testDbPath)) File.Delete(_testDbPath);
            var wal = _testDbPath + "-wal";
            if (File.Exists(wal)) File.Delete(wal);
            var shm = _testDbPath + "-shm";
            if (File.Exists(shm)) File.Delete(shm);
        }
        catch { }
    }

    [Fact]
    public async Task HealthLiveEndpoint_ReturnsStatusUp()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var content = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(content);
        Assert.Equal("UP", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("inventory-service", doc.RootElement.GetProperty("service").GetString());
    }

    [Fact]
    public async Task HealthReadyEndpoint_ReturnsStatusUpWithDatabase()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var content = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(content);
        Assert.Equal("UP", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("UP", doc.RootElement.GetProperty("database").GetString());
    }

    [Fact]
    public async Task PrometheusMetricsEndpoint_IsReachableAndReturnsMetrics()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/metrics");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var content = await response.Content.ReadAsStringAsync();
        Assert.NotEmpty(content);
    }

    [Fact]
    public async Task InventoryPersistence_CanSaveAndRetrieveStockItem()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"TEST-SKU-{Guid.NewGuid():N}";
        var item = new StockItem
        {
            ProductId = $"prod-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 150,
            ReservedQuantity = 10,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        db.StockItems.Add(item);
        await db.SaveChangesAsync();

        var retrieved = await db.StockItems.AsNoTracking().FirstOrDefaultAsync(s => s.Sku == sku);
        Assert.NotNull(retrieved);
        Assert.Equal(150, retrieved.AvailableQuantity);
        Assert.Equal(10, retrieved.ReservedQuantity);
    }

    [Fact]
    public void PooledConnections_HaveEffectivePragmaSettings()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        for (int i = 0; i < 3; i++)
        {
            db.Database.OpenConnection();
            var conn = db.Database.GetDbConnection();

            using var cmd = conn.CreateCommand();

            cmd.CommandText = "PRAGMA foreign_keys;";
            var fk = Convert.ToInt32(cmd.ExecuteScalar());
            Assert.Equal(1, fk);

            cmd.CommandText = "PRAGMA busy_timeout;";
            var bt = Convert.ToInt32(cmd.ExecuteScalar());
            Assert.Equal(5000, bt);

            cmd.CommandText = "PRAGMA journal_mode;";
            var jm = cmd.ExecuteScalar()?.ToString()?.ToLower();
            Assert.Equal("wal", jm);

            cmd.CommandText = "PRAGMA synchronous;";
            var sync = Convert.ToInt32(cmd.ExecuteScalar());
            Assert.Equal(1, sync);

            db.Database.CloseConnection();
        }
    }

    [Fact]
    public async Task GetNonExistentSku_ReturnsProblemDetails404()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/inventory/NON_EXISTENT_SKU_12345");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var content = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(content);
        Assert.Equal(404, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("https://causalotel.io/errors/404", doc.RootElement.GetProperty("type").GetString());
    }

    [Fact]
    public async Task Reserve_Commit_And_Release_Workflow()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-TEST-RES-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 10,
            ReservedQuantity = 0,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await db.SaveChangesAsync();

        var client = _factory.CreateClient();
        var orderId = $"ORD-RES-{Guid.NewGuid():N}";

        // 1. Reserve 3 items
        var reserveReq = new ReserveRequest(orderId, new List<ReserveItemDto> { new ReserveItemDto(sku, 3) });
        var resResponse = await client.PostAsJsonAsync("/api/inventory/reserve", reserveReq);
        Assert.Equal(HttpStatusCode.OK, resResponse.StatusCode);

        // Check stock: available 7, reserved 3
        var itemAfterReserve = await db.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(7, itemAfterReserve.AvailableQuantity);
        Assert.Equal(3, itemAfterReserve.ReservedQuantity);

        // 2. Duplicate reservation is idempotent
        var dupResponse = await client.PostAsJsonAsync("/api/inventory/reserve", reserveReq);
        Assert.Equal(HttpStatusCode.OK, dupResponse.StatusCode);

        // 3. Commit reservation
        var commitReq = new CommitRequest(orderId);
        var commitResp = await client.PostAsJsonAsync("/api/inventory/commit", commitReq);
        Assert.Equal(HttpStatusCode.OK, commitResp.StatusCode);

        // Check stock: available 7, reserved 0
        var itemAfterCommit = await db.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(7, itemAfterCommit.AvailableQuantity);
        Assert.Equal(0, itemAfterCommit.ReservedQuantity);
    }

    [Fact]
    public async Task Reserve_Release_Workflow_RestoresStock()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-TEST-REL-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 5,
            ReservedQuantity = 0,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await db.SaveChangesAsync();

        var client = _factory.CreateClient();
        var orderId = $"ORD-REL-{Guid.NewGuid():N}";

        // Reserve 4
        var reserveReq = new ReserveRequest(orderId, new List<ReserveItemDto> { new ReserveItemDto(sku, 4) });
        var resResponse = await client.PostAsJsonAsync("/api/inventory/reserve", reserveReq);
        Assert.Equal(HttpStatusCode.OK, resResponse.StatusCode);

        // Release
        var releaseReq = new ReleaseRequest(orderId, "Payment declined");
        var relResponse = await client.PostAsJsonAsync("/api/inventory/release", releaseReq);
        Assert.Equal(HttpStatusCode.OK, relResponse.StatusCode);

        // Stock restored: available 5, reserved 0
        var itemAfterRelease = await db.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(5, itemAfterRelease.AvailableQuantity);
        Assert.Equal(0, itemAfterRelease.ReservedQuantity);
    }

    [Fact]
    public async Task Reserve_InsufficientStock_ReturnsConflict409()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-TEST-LOW-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 2,
            ReservedQuantity = 0,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await db.SaveChangesAsync();

        var client = _factory.CreateClient();
        var orderId = $"ORD-LOW-{Guid.NewGuid():N}";

        // Try reserving 5 when only 2 available
        var reserveReq = new ReserveRequest(orderId, new List<ReserveItemDto> { new ReserveItemDto(sku, 5) });
        var response = await client.PostAsJsonAsync("/api/inventory/reserve", reserveReq);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
