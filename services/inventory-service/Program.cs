using System;
using System.IO;
using CausalOTel.InventoryService.Data;
using Microsoft.AspNetCore.Builder;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

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
                options.Endpoint = new Uri(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4318/v1/traces");
            });
    })
    .WithMetrics(metrics =>
    {
        metrics
            .AddAspNetCoreInstrumentation()
            .AddHttpClientInstrumentation()
            .AddPrometheusExporter();
    });

// 2. Configure Database Path in LocalAppData (Outside OneDrive)
var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
var dataDir = Path.Combine(localAppData, "CausalOTel", "data");
Directory.CreateDirectory(dataDir);
var dbPath = builder.Configuration["SQLITE_DB_PATH"] ?? Path.Combine(dataDir, "inventory.db");

// Build SQLite Connection String with DefaultTimeout = 5s (5000ms busy_timeout)
var connectionString = new SqliteConnectionStringBuilder
{
    DataSource = dbPath,
    Mode = SqliteOpenMode.ReadWriteCreate,
    DefaultTimeout = 5
}.ToString();

builder.Services.AddSingleton<SqlitePragmaConnectionInterceptor>();

builder.Services.AddDbContext<InventoryDbContext>((sp, options) =>
{
    var interceptor = sp.GetRequiredService<SqlitePragmaConnectionInterceptor>();
    options.UseSqlite(connectionString)
           .AddInterceptors(interceptor);
});

// 3. Register RFC 9457 Global Exception Handler
builder.Services.AddExceptionHandler<ProblemDetailsExceptionHandler>();
builder.Services.AddProblemDetails();

builder.Services.AddControllers();

var app = builder.Build();

app.UseExceptionHandler();

// Expose Prometheus Scraping Endpoint on /metrics
app.UseOpenTelemetryPrometheusScrapingEndpoint("/metrics");

// 4. One-Time Database Header Initialization & Schema Baseline
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
    var conn = db.Database.GetDbConnection();
    conn.Open();
    using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "PRAGMA journal_mode = WAL; PRAGMA page_size = 4096;";
        cmd.ExecuteNonQuery();
    }
    db.Database.EnsureCreated();
}

app.MapControllers();

app.Run();

// Expose Program for WebApplicationFactory tests
public partial class Program { }
