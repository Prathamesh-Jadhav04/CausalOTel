using System;
using System.IO;
using System.Linq;
using CausalOTel.InventoryService.Data;
using CausalOTel.InventoryService.Models;
using CausalOTel.InventoryService.Security;
using CausalOTel.InventoryService.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Exporter;

var builder = WebApplication.CreateBuilder(args);

// The collector exposes OTLP/HTTP on :4318.  The .NET exporter otherwise
// defaults to gRPC (:4317), so be explicit about both the protocol and the
// signal-specific endpoint.  A base endpoint is accepted as a convenience,
// but it is normalized before it reaches the exporter.
var configuredOtlpEndpoint = builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]
    ?? "http://localhost:4318";
var otlpTraceEndpoint = ResolveOtlpTraceEndpoint(configuredOtlpEndpoint);

// 1. Configure OpenTelemetry Tracing & Metrics
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("inventory-service"))
    .WithTracing(tracing =>
    {
        tracing
            .AddAspNetCoreInstrumentation()
            .AddHttpClientInstrumentation()
            .AddOtlpExporter(options =>
            {
                options.Protocol = OtlpExportProtocol.HttpProtobuf;
                options.Endpoint = otlpTraceEndpoint;
            });
    })
    .WithMetrics(metrics =>
    {
        metrics
            .AddAspNetCoreInstrumentation()
            .AddHttpClientInstrumentation()
            .AddPrometheusExporter();
    });

// 2. Configure Database Path in LocalAppData (Outside OneDrive).
// In the Testing environment the path must be an explicit temporary database:
// refusing anything else prevents tests from opening or deleting live data.
var isTesting = builder.Environment.IsEnvironment("Testing");
var postgresConnectionString = builder.Configuration["POSTGRES_CONNECTION_STRING"];
var usePostgres = !string.IsNullOrWhiteSpace(postgresConnectionString);
var configuredDbPath = builder.Configuration["SQLITE_DB_PATH"];
string? dbPath = null;
if (isTesting)
{
    if (usePostgres)
    {
        throw new InvalidOperationException("Testing environment must use an isolated SQLite database.");
    }
    if (string.IsNullOrWhiteSpace(configuredDbPath))
    {
        throw new InvalidOperationException(
            "Testing environment requires SQLITE_DB_PATH to point at an isolated temporary database.");
    }

    dbPath = Path.GetFullPath(configuredDbPath);
    var tempRoot = Path.GetFullPath(Path.GetTempPath());
    if (!IsPathWithin(dbPath, tempRoot))
    {
        throw new InvalidOperationException(
            $"Refusing to run tests against a non-temporary database: {dbPath}");
    }
}
else if (!usePostgres)
{
    var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    var dataDir = Path.Combine(localAppData, "CausalOTel", "data");
    Directory.CreateDirectory(dataDir);
    dbPath = configuredDbPath ?? Path.Combine(dataDir, "inventory.db");
}

static Uri ResolveOtlpTraceEndpoint(string configuredEndpoint)
{
    if (!Uri.TryCreate(configuredEndpoint, UriKind.Absolute, out var endpoint)
        || (endpoint.Scheme != Uri.UriSchemeHttp && endpoint.Scheme != Uri.UriSchemeHttps))
    {
        throw new InvalidOperationException(
            "OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute HTTP or HTTPS URI.");
    }

    // AddOtlpExporter uses an endpoint as-is.  The OTLP/HTTP trace path is
    // required when callers configure the common base URL rather than a
    // signal-specific URL.
    if (endpoint.AbsolutePath is "" or "/")
    {
        return new Uri(endpoint.ToString().TrimEnd('/') + "/v1/traces");
    }

    return endpoint;
}

static bool IsPathWithin(string path, string root)
{
    var normalizedRoot = Path.GetFullPath(root)
        .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
        + Path.DirectorySeparatorChar;
    return Path.GetFullPath(path)
        .StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
}

// Build SQLite Connection String with DefaultTimeout = 5s (5000ms busy_timeout)
var connectionString = usePostgres
    ? postgresConnectionString!
    : new SqliteConnectionStringBuilder
    {
        DataSource = dbPath,
        Mode = SqliteOpenMode.ReadWriteCreate,
        DefaultTimeout = 5
    }.ToString();

builder.Services.AddSingleton<SqlitePragmaConnectionInterceptor>();
builder.Services.AddSingleton<InventoryFaultState>();

// H-02: signed bearer-token authentication for every business endpoint.
builder.Services.AddSingleton<TokenValidator>();
builder.Services.AddSingleton<ServiceTokenProvider>();
builder.Services
    .AddAuthentication(BearerAuthenticationHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, BearerAuthenticationHandler>(
        BearerAuthenticationHandler.SchemeName, null);
builder.Services.AddAuthorization();

if (!isTesting)
{
    builder.Services.AddHostedService<ReservationExpiryWorker>();
}

builder.Services.AddDbContext<InventoryDbContext>((sp, options) =>
{
    if (usePostgres)
    {
        options.UseNpgsql(connectionString);
    }
    else
    {
        var interceptor = sp.GetRequiredService<SqlitePragmaConnectionInterceptor>();
        options.UseSqlite(connectionString)
               .AddInterceptors(interceptor);
    }
});

// 3. Register RFC 9457 Global Exception Handler
builder.Services.AddExceptionHandler<ProblemDetailsExceptionHandler>();
builder.Services.AddProblemDetails();

builder.Services.AddControllers();

var app = builder.Build();

app.UseExceptionHandler();

// Expose Prometheus Scraping Endpoint on /metrics
app.UseOpenTelemetryPrometheusScrapingEndpoint("/metrics");

app.UseAuthentication();
app.UseAuthorization();

// 4. One-Time Database Header Initialization & Schema Baseline & Seeding
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
    if (!usePostgres)
    {
        var conn = db.Database.GetDbConnection();
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA journal_mode = WAL; PRAGMA page_size = 4096;";
        cmd.ExecuteNonQuery();
    }
    db.Database.EnsureCreated();

    // H-04 schema upgrade for databases created before the unique constraint.
    // EnsureCreated() does not alter an existing table, so add the canonical
    // request hash column and the unique (OrderId, Sku) index explicitly.
    if (!usePostgres)
    {
        var conn = db.Database.GetDbConnection();
        using var schemaCmd = conn.CreateCommand();
        schemaCmd.CommandText = "PRAGMA table_info(stock_reservations)";
        bool hasRequestHash = false;
        using (var reader = schemaCmd.ExecuteReader())
        {
            while (reader.Read())
            {
                if (string.Equals(reader.GetString(1), "RequestHash", StringComparison.OrdinalIgnoreCase))
                {
                    hasRequestHash = true;
                    break;
                }
            }
        }

        if (!hasRequestHash)
        {
            using var alterCmd = conn.CreateCommand();
            alterCmd.CommandText =
                "ALTER TABLE stock_reservations ADD COLUMN RequestHash TEXT NOT NULL DEFAULT ''";
            alterCmd.ExecuteNonQuery();
        }

        using var indexCmd = conn.CreateCommand();
        indexCmd.CommandText =
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_reservations_order_sku " +
            "ON stock_reservations(OrderId, Sku)";
        indexCmd.ExecuteNonQuery();
    }

    long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    if (!db.StockItems.Any())
    {
        db.StockItems.AddRange(
            new StockItem { ProductId = "PROD-001", Sku = "SKU-LAPTOP-001", AvailableQuantity = 50, ReservedQuantity = 0, UpdatedAt = now },
            new StockItem { ProductId = "PROD-002", Sku = "SKU-PHONE-002", AvailableQuantity = 100, ReservedQuantity = 0, UpdatedAt = now },
            new StockItem { ProductId = "PROD-003", Sku = "SKU-HEADPHONES-003", AvailableQuantity = 200, ReservedQuantity = 0, UpdatedAt = now },
            new StockItem { ProductId = "PROD-004", Sku = "SKU-OUT-OF-STOCK-004", AvailableQuantity = 0, ReservedQuantity = 0, UpdatedAt = now }
        );
        db.SaveChanges();
    }
}

app.MapControllers();

app.Run();

// Expose Program for WebApplicationFactory tests
public partial class Program { }
