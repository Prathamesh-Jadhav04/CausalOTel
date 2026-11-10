namespace CausalOTel.InventoryService.Data;

using CausalOTel.InventoryService.Models;
using Microsoft.EntityFrameworkCore;

public class InventoryDbContext : DbContext
{
    public InventoryDbContext(DbContextOptions<InventoryDbContext> options) : base(options)
    {
    }

    public DbSet<StockItem> StockItems => Set<StockItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<StockItem>(entity =>
        {
            entity.ToTable("stock_items");
            entity.HasKey(e => e.ProductId);
            entity.Property(e => e.ProductId).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Sku).HasMaxLength(64).IsRequired();
            entity.Property(e => e.AvailableQuantity).IsRequired();
            entity.Property(e => e.ReservedQuantity).IsRequired();
            entity.Property(e => e.UpdatedAt).IsRequired();
        });
    }
}
