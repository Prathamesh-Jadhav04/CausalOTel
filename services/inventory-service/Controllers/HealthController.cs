namespace CausalOTel.InventoryService.Controllers;

using System;
using System.Diagnostics;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

[ApiController]
[Route("")]
public class HealthController : ControllerBase
{
    private readonly InventoryDbContext _dbContext;

    public HealthController(InventoryDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("health/live")]
    public IActionResult GetLiveness()
    {
        return Ok(new
        {
            status = "UP",
            service = "inventory-service",
            runtime = ".NET 10.0.404",
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
    }

    [HttpGet("health/ready")]
    public async Task<IActionResult> GetReadiness()
    {
        try
        {
            bool canConnect = await _dbContext.Database.CanConnectAsync();
            if (canConnect)
            {
                return Ok(new
                {
                    status = "UP",
                    database = "UP",
                    storage = "DURABLE_SQLITE",
                    timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                });
            }

            return StatusCode(503, new
            {
                status = "DOWN",
                database = "DISCONNECTED",
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            });
        }
        catch (Exception)
        {
            return StatusCode(503, new
            {
                status = "DOWN",
                database = "UNAVAILABLE",
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            });
        }
    }

    [HttpGet("health")]
    public async Task<IActionResult> GetHealth()
    {
        return await GetReadiness();
    }
}
