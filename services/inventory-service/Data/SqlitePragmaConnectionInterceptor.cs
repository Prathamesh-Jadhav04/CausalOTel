using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace CausalOTel.InventoryService.Data;

/// <summary>
/// Intercepts EF Core SQLite connection openings to reliably enforce
/// foreign key constraints, busy_timeout, NORMAL synchronous mode, and in-memory temp store
/// across every pooled connection.
/// Executes PRAGMAs individually to prevent multi-statement truncation.
/// </summary>
public class SqlitePragmaConnectionInterceptor : DbConnectionInterceptor
{
    private static readonly string[] PragmaCommands = new[]
    {
        "PRAGMA foreign_keys = ON;",
        "PRAGMA busy_timeout = 5000;",
        "PRAGMA synchronous = NORMAL;",
        "PRAGMA temp_store = MEMORY;"
    };

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        foreach (var sql in PragmaCommands)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }
        base.ConnectionOpened(connection, eventData);
    }

    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        foreach (var sql in PragmaCommands)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }
        await base.ConnectionOpenedAsync(connection, eventData, cancellationToken);
    }
}
