using System.Collections.Generic;
using System.Threading.Tasks;
using CausalOTel.InventoryService.Data;
using CausalOTel.InventoryService.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CausalOTel.InventoryService.Controllers;

[ApiController]
[Route("api/inventory")]
public class InventoryController : ControllerBase
{
    private readonly InventoryDbContext _context;

    public InventoryController(InventoryDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<StockItem>>> GetStockItems()
    {
        var items = await _context.StockItems.AsNoTracking().ToListAsync();
        return Ok(items);
    }

    [HttpGet("{sku}")]
    public async Task<ActionResult<StockItem>> GetStockItem(string sku)
    {
        var item = await _context.StockItems.AsNoTracking().FirstOrDefaultAsync(s => s.Sku == sku);
        if (item == null)
        {
            return NotFound(new ProblemDetails
            {
                Type = "https://causalotel.io/errors/404",
                Title = "Stock Item Not Found",
                Status = 404,
                Detail = $"No inventory record found for SKU: {sku}"
            });
        }
        return Ok(item);
    }
}
