namespace CausalOTel.InventoryService.Models;

public class StockReservation
{
    public string Id { get; set; } = string.Empty;
    public string OrderId { get; set; } = string.Empty;
    public string Sku { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public string Status { get; set; } = "PENDING"; // PENDING, RESERVED, COMMITTED, RELEASED, EXPIRED
    public long ExpiresAt { get; set; } // Epoch ms UTC
    public long CreatedAt { get; set; } // Epoch ms UTC
    public long UpdatedAt { get; set; } // Epoch ms UTC
}
