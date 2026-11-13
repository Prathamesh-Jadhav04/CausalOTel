namespace CausalOTel.InventoryService.Models;

public class StockItem
{
    public string ProductId { get; set; } = string.Empty;
    public string Sku { get; set; } = string.Empty;
    public int AvailableQuantity { get; set; }
    public int ReservedQuantity { get; set; }
    public long UpdatedAt { get; set; } // Unix epoch milliseconds in UTC
}
