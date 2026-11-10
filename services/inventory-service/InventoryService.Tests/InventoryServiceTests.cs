using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
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
            builder.UseSetting("SQLITE_DB_PATH", _testDbPath);
            builder.ConfigureServices(services =>
            {
                // Ensure fresh schema for tests
                var sp = services.BuildServiceProvider();
                using var scope = sp.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
                db.Database.EnsureCreated();
            });
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
            ProductId = "prod-test-01",
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
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open) conn.Open();

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
            Assert.Equal(1, sync); // 1 = NORMAL
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
}
