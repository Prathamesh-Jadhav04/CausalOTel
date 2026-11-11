using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Controllers;
using CausalOTel.InventoryService.Data;
using CausalOTel.InventoryService.Models;
using CausalOTel.InventoryService.Security;
using CausalOTel.InventoryService.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
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
        AssertSafeTestDatabasePath(_testDbPath);
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

    private static void AssertSafeTestDatabasePath(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var tempRoot = Path.GetFullPath(Path.GetTempPath());
        if (!fullPath.StartsWith(tempRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Refusing destructive test cleanup outside the temp directory: {fullPath}");
        }

        var liveData = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CausalOTel", "data"));
        if (fullPath.StartsWith(liveData, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Refusing destructive test cleanup against live CausalOTel data: {fullPath}");
        }
    }

    [Fact]
    public async Task HealthLiveEndpoint_ReturnsStatusUp()
    {
        var client = CreateAuthenticatedClient("ROLE_SERVICE");
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
        var client = CreateAuthenticatedClient("ROLE_SERVICE");
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
        var client = CreateAuthenticatedClient("ROLE_SERVICE");
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
        var client = CreateAuthenticatedClient("ROLE_SERVICE");
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

        var client = CreateAuthenticatedClient("ROLE_SERVICE");
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

        var client = CreateAuthenticatedClient("ROLE_SERVICE");
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

        var client = CreateAuthenticatedClient("ROLE_SERVICE");
        var orderId = $"ORD-LOW-{Guid.NewGuid():N}";

        // Try reserving 5 when only 2 available
        var reserveReq = new ReserveRequest(orderId, new List<ReserveItemDto> { new ReserveItemDto(sku, 5) });
        var response = await client.PostAsJsonAsync("/api/inventory/reserve", reserveReq);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Scenario8_TwoCustomersAttemptToPurchaseFinalItemSimultaneously()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-FINAL-ITEM-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 1, // Exactly 1 item left in stock!
            ReservedQuantity = 0,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await db.SaveChangesAsync();

        var client = CreateAuthenticatedClient("ROLE_SERVICE");
        var orderId1 = $"ORD-CUST-1-{Guid.NewGuid():N}";
        var orderId2 = $"ORD-CUST-2-{Guid.NewGuid():N}";

        var req1 = new ReserveRequest(orderId1, new List<ReserveItemDto> { new ReserveItemDto(sku, 1) });
        var req2 = new ReserveRequest(orderId2, new List<ReserveItemDto> { new ReserveItemDto(sku, 1) });

        // Fire both requests genuinely simultaneously
        var task1 = client.PostAsJsonAsync("/api/inventory/reserve", req1);
        var task2 = client.PostAsJsonAsync("/api/inventory/reserve", req2);

        await Task.WhenAll(task1, task2);

        var resp1 = await task1;
        var resp2 = await task2;

        // Exactly one customer succeeds (200 OK) and one receives 409 Conflict
        var successCount = (resp1.StatusCode == HttpStatusCode.OK ? 1 : 0) + (resp2.StatusCode == HttpStatusCode.OK ? 1 : 0);
        var conflictCount = (resp1.StatusCode == HttpStatusCode.Conflict ? 1 : 0) + (resp2.StatusCode == HttpStatusCode.Conflict ? 1 : 0);

        Assert.Equal(1, successCount);
        Assert.Equal(1, conflictCount);

        // Verify stock in DB: Available MUST be 0, Reserved MUST be 1. Overselling prevented!
        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var finalItem = await verifyDb.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(0, finalItem.AvailableQuantity);
        Assert.Equal(1, finalItem.ReservedQuantity);
    }

    [Fact]
    public async Task Scenario6_InventoryReservationExpired_ReclaimsStockOnCommit()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-EXP-RECLAIM-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 5,
            ReservedQuantity = 0,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await db.SaveChangesAsync();

        var orderId = $"ORD-EXPIRED-{Guid.NewGuid():N}";
        var reservationId = $"res-{Guid.NewGuid():N}";
        var pastTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 60000;

        // Reservation was expired while payment was in-flight
        db.StockReservations.Add(new StockReservation
        {
            Id = reservationId,
            OrderId = orderId,
            Sku = sku,
            Quantity = 2,
            Status = "EXPIRED",
            CreatedAt = pastTime - 120000,
            ExpiresAt = pastTime,
            UpdatedAt = pastTime
        });
        await db.SaveChangesAsync();

        var client = CreateAuthenticatedClient("ROLE_SERVICE");

        // Customer's payment actually succeeded! Order service calls commit
        var commitReq = new CommitRequest(orderId);
        var commitResp = await client.PostAsJsonAsync("/api/inventory/commit", commitReq);

        Assert.Equal(HttpStatusCode.OK, commitResp.StatusCode);

        // Verify that stock was reclaimed and committed
        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var itemAfterCommit = await verifyDb.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(3, itemAfterCommit.AvailableQuantity); // 5 - 2 = 3
        Assert.Equal(0, itemAfterCommit.ReservedQuantity);

        var reservation = await verifyDb.StockReservations.AsNoTracking().FirstAsync(r => r.Id == reservationId);
        Assert.Equal("COMMITTED", reservation.Status);
    }

    [Fact]
    public void TestDatabase_IsIsolatedFromLiveApplicationData()
    {
        var configuredPath = Path.GetFullPath(_testDbPath);
        var tempRoot = Path.GetFullPath(Path.GetTempPath());
        Assert.StartsWith(tempRoot, configuredPath, StringComparison.OrdinalIgnoreCase);

        var liveData = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CausalOTel", "data"));
        Assert.False(
            configuredPath.StartsWith(liveData, StringComparison.OrdinalIgnoreCase),
            $"Test database must not live under {liveData}");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var actualPath = Path.GetFullPath(db.Database.GetDbConnection().DataSource);
        Assert.Equal(configuredPath, actualPath, ignoreCase: true);
    }

    [Fact]
    public async Task H04_ConcurrentReserveForSameOrderConsumesStockOnce()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-H04-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 20,
            ReservedQuantity = 0,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await db.SaveChangesAsync();

        var client = CreateAuthenticatedClient("ROLE_SERVICE");
        var orderId = $"ORD-H04-{Guid.NewGuid():N}";
        var request = new ReserveRequest(orderId,
            new List<ReserveItemDto> { new ReserveItemDto(sku, 1) });

        var tasks = Enumerable.Range(0, 20)
            .Select(_ => client.PostAsJsonAsync("/api/inventory/reserve", request))
            .ToList();
        var responses = await Task.WhenAll(tasks);

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var stock = await verifyDb.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(19, stock.AvailableQuantity);
        Assert.Equal(1, stock.ReservedQuantity);

        var reservationCount = await verifyDb.StockReservations.AsNoTracking()
            .CountAsync(r => r.OrderId == orderId);
        Assert.Equal(1, reservationCount);
    }

    [Fact]
    public async Task H04_SameOrderDifferentPayloadIsRejectedWithoutStockChange()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-H04-PAYLOAD-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 10,
            ReservedQuantity = 0,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await db.SaveChangesAsync();

        var client = CreateAuthenticatedClient("ROLE_SERVICE");
        var orderId = $"ORD-H04-PAYLOAD-{Guid.NewGuid():N}";

        var first = await client.PostAsJsonAsync("/api/inventory/reserve",
            new ReserveRequest(orderId, new List<ReserveItemDto> { new ReserveItemDto(sku, 1) }));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/api/inventory/reserve",
            new ReserveRequest(orderId, new List<ReserveItemDto> { new ReserveItemDto(sku, 3) }));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var stock = await verifyDb.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(9, stock.AvailableQuantity);
        Assert.Equal(1, stock.ReservedQuantity);
    }

    [Fact]
    public async Task H05_ReservationStateMachineRejectsInvalidTransitions()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-H05-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 10,
            ReservedQuantity = 0,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await db.SaveChangesAsync();

        var client = CreateAuthenticatedClient("ROLE_SERVICE");

        // COMMITTED is terminal: release must be rejected.
        var committedOrder = $"ORD-H05-C-{Guid.NewGuid():N}";
        var reserve1 = await client.PostAsJsonAsync("/api/inventory/reserve",
            new ReserveRequest(committedOrder, new List<ReserveItemDto> { new ReserveItemDto(sku, 1) }));
        Assert.Equal(HttpStatusCode.OK, reserve1.StatusCode);
        var commit1 = await client.PostAsJsonAsync("/api/inventory/commit", new CommitRequest(committedOrder));
        Assert.Equal(HttpStatusCode.OK, commit1.StatusCode);
        var releaseCommitted = await client.PostAsJsonAsync("/api/inventory/release",
            new ReleaseRequest(committedOrder, "should fail"));
        Assert.Equal(HttpStatusCode.Conflict, releaseCommitted.StatusCode);

        // RELEASED is terminal: commit must be rejected.
        var releasedOrder = $"ORD-H05-R-{Guid.NewGuid():N}";
        var reserve2 = await client.PostAsJsonAsync("/api/inventory/reserve",
            new ReserveRequest(releasedOrder, new List<ReserveItemDto> { new ReserveItemDto(sku, 1) }));
        Assert.Equal(HttpStatusCode.OK, reserve2.StatusCode);
        var release2 = await client.PostAsJsonAsync("/api/inventory/release",
            new ReleaseRequest(releasedOrder, "declined"));
        Assert.Equal(HttpStatusCode.OK, release2.StatusCode);
        var commitReleased = await client.PostAsJsonAsync("/api/inventory/commit",
            new CommitRequest(releasedOrder));
        Assert.Equal(HttpStatusCode.Conflict, commitReleased.StatusCode);

        // Releasing again is idempotent.
        var releaseAgain = await client.PostAsJsonAsync("/api/inventory/release",
            new ReleaseRequest(releasedOrder, "declined again"));
        Assert.Equal(HttpStatusCode.OK, releaseAgain.StatusCode);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var stock = await verifyDb.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(9, stock.AvailableQuantity); // one committed, one released
        Assert.Equal(0, stock.ReservedQuantity);
    }

    [Fact]
    public async Task H08_ExpiryWorkerResolvesPaymentBeforeOpeningWriteTransactions()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-H08-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 5,
            ReservedQuantity = 2,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });

        var orderId = $"ORD-H08-{Guid.NewGuid():N}";
        long past = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 60_000;
        db.StockReservations.Add(new StockReservation
        {
            Id = $"res-{Guid.NewGuid():N}",
            OrderId = orderId,
            Sku = sku,
            Quantity = 2,
            Status = "RESERVED",
            RequestHash = "test-hash",
            CreatedAt = past - 60_000,
            ExpiresAt = past,
            UpdatedAt = past
        });
        await db.SaveChangesAsync();

        var handler = new StubPaymentHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = JsonContent.Create(new { status = "CAPTURED" })
        });
        var worker = new ReservationExpiryWorker(
            _factory.Services,
            NullLogger<ReservationExpiryWorker>.Instance,
            new ConfigurationBuilder().Build(),
            new HttpClient(handler));

        await worker.ExpireStaleReservationsAsync();

        Assert.False(worker.HttpCallObservedDuringTransaction,
            "Payment HTTP calls must happen before any write transaction is opened");
        Assert.Equal(1, worker.HttpCallCount);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var reservation = await verifyDb.StockReservations.AsNoTracking()
            .FirstAsync(r => r.OrderId == orderId);
        Assert.Equal("COMMITTED", reservation.Status);

        var stock = await verifyDb.StockItems.AsNoTracking().FirstAsync(s => s.Sku == sku);
        Assert.Equal(5, stock.AvailableQuantity);
        Assert.Equal(0, stock.ReservedQuantity);
    }

    [Fact]
    public async Task H08_OneOrderOutcomeDoesNotRollBackAnotherOrder()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();

        var sku = $"SKU-H08-BATCH-{Guid.NewGuid():N}";
        db.StockItems.Add(new StockItem
        {
            ProductId = $"PROD-{Guid.NewGuid():N}",
            Sku = sku,
            AvailableQuantity = 10,
            ReservedQuantity = 2,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });

        var capturedOrder = $"ORD-H08-CAP-{Guid.NewGuid():N}";
        var unknownOrder = $"ORD-H08-UNK-{Guid.NewGuid():N}";
        long past = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 60_000;

        db.StockReservations.AddRange(
            new StockReservation
            {
                Id = $"res-{Guid.NewGuid():N}",
                OrderId = capturedOrder,
                Sku = sku,
                Quantity = 1,
                Status = "RESERVED",
                RequestHash = "captured",
                CreatedAt = past - 60_000,
                ExpiresAt = past,
                UpdatedAt = past
            },
            new StockReservation
            {
                Id = $"res-{Guid.NewGuid():N}",
                OrderId = unknownOrder,
                Sku = sku,
                Quantity = 1,
                Status = "RESERVED",
                RequestHash = "unknown",
                CreatedAt = past - 60_000,
                ExpiresAt = past,
                UpdatedAt = past
            });
        await db.SaveChangesAsync();

        var handler = new StubPaymentHandler(orderId =>
        {
            if (orderId == unknownOrder)
            {
                return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
            }
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new { status = "CAPTURED" })
            };
        });
        var worker = new ReservationExpiryWorker(
            _factory.Services,
            NullLogger<ReservationExpiryWorker>.Instance,
            new ConfigurationBuilder().Build(),
            new HttpClient(handler));

        await worker.ExpireStaleReservationsAsync();

        Assert.False(worker.HttpCallObservedDuringTransaction);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var captured = await verifyDb.StockReservations.AsNoTracking()
            .FirstAsync(r => r.OrderId == capturedOrder);
        var unknown = await verifyDb.StockReservations.AsNoTracking()
            .FirstAsync(r => r.OrderId == unknownOrder);

        Assert.Equal("COMMITTED", captured.Status);
        Assert.Equal("RESERVED", unknown.Status);
        Assert.True(unknown.ExpiresAt > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            "An unknown payment outcome must extend the reservation TTL");
    }

    private HttpClient CreateAuthenticatedClient(string role)
    {
        var client = _factory.CreateClient();
        var provider = new ServiceTokenProvider(new ConfigurationBuilder().Build());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", provider.CreateToken($"test-{role}", $"test-{role}", role, 600));
        return client;
    }

    [Fact]
    public async Task H02_AnonymousBusinessEndpointsAreRejected()
    {
        var client = _factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/inventory")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/inventory/reserve",
                new ReserveRequest("ORD-ANON", new List<ReserveItemDto> { new("SKU-X", 1) }))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/inventory/fault",
                new FaultRequest(0, false, false, null))).StatusCode);
    }

    [Fact]
    public async Task H02_UserRoleCanReadButCannotMutateInventory()
    {
        var userClient = CreateAuthenticatedClient("ROLE_USER");
        Assert.Equal(HttpStatusCode.OK, (await userClient.GetAsync("/api/inventory")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await userClient.PostAsJsonAsync("/api/inventory/reserve",
                new ReserveRequest("ORD-USER", new List<ReserveItemDto> { new("SKU-X", 1) }))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await userClient.PostAsJsonAsync("/api/inventory/commit",
                new CommitRequest("ORD-USER"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await userClient.PostAsJsonAsync("/api/inventory/release",
                new ReleaseRequest("ORD-USER", "test"))).StatusCode);
    }

    [Fact]
    public async Task H01_FaultConfigurationIsAdminOnlyAndBounded()
    {
        var userClient = CreateAuthenticatedClient("ROLE_USER");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await userClient.PostAsJsonAsync("/api/inventory/fault",
                new FaultRequest(100, false, false, null))).StatusCode);

        var adminClient = CreateAuthenticatedClient("ROLE_ADMIN");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await adminClient.PostAsJsonAsync("/api/inventory/fault",
                new FaultRequest(10_001, false, false, null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await adminClient.PostAsJsonAsync("/api/inventory/fault",
                new FaultRequest(0, false, true, new string('x', 501)))).StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var state = scope.ServiceProvider.GetRequiredService<InventoryFaultState>();
            Assert.Equal(0, state.LatencyMs);
            Assert.False(state.SimulateError);
            Assert.Null(state.ErrorMessage);
        }

        var accepted = await adminClient.PostAsJsonAsync("/api/inventory/fault",
            new FaultRequest(250, false, true, "injected"));
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var state = scope.ServiceProvider.GetRequiredService<InventoryFaultState>();
            Assert.Equal(250, state.LatencyMs);
            Assert.True(state.SimulateError);
            Assert.Equal("injected", state.ErrorMessage);
            state.Reset();
        }
    }

    [Fact]
    public async Task H01_FaultInjectionCanBeDisabled()
    {
        string disabledDbPath = Path.Combine(Path.GetTempPath(), $"causalotel_inv_disabled_{Guid.NewGuid():N}.db");
        try
        {
            using var factory = _factory.WithWebHostBuilder(builder =>
            {
                builder.UseSetting("SQLITE_DB_PATH", disabledDbPath);
                builder.UseSetting("CAUSALOTEL_FAULT_INJECTION_ENABLED", "false");
            });
            var client = factory.CreateClient();
            var provider = new ServiceTokenProvider(new ConfigurationBuilder().Build());
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
                "Bearer", provider.CreateToken("admin", "admin", "ROLE_ADMIN", 600));

            Assert.Equal(HttpStatusCode.NotFound,
                (await client.GetAsync("/api/inventory/fault")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,
                (await client.PostAsJsonAsync("/api/inventory/fault",
                    new FaultRequest(0, false, false, null))).StatusCode);
        }
        finally
        {
            AssertSafeTestDatabasePath(disabledDbPath);
            try
            {
                Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
                if (File.Exists(disabledDbPath)) File.Delete(disabledDbPath);
                foreach (string suffix in new[] { "-wal", "-shm" })
                {
                    string path = disabledDbPath + suffix;
                    if (File.Exists(path)) File.Delete(path);
                }
            }
            catch (IOException)
            {
                // The isolated temp database is left for the OS temp cleaner if
                // SQLite still holds a pooled handle at test shutdown.
            }
        }
    }

    private sealed class StubPaymentHandler : HttpMessageHandler
    {
        private readonly Func<string, HttpResponseMessage> _responder;

        public StubPaymentHandler(Func<string, HttpResponseMessage> responder)
        {
            _responder = responder;
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            string path = request.RequestUri?.AbsolutePath ?? string.Empty;
            string orderId = path.Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? string.Empty;
            return Task.FromResult(_responder(orderId));
        }
    }
}
