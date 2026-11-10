namespace CausalOTel.InventoryService.Data;

using CausalOTel.InventoryService.Models;
using Microsoft.EntityFrameworkCore;

public class InventoryDbContext : DbContext
{
    public InventoryDbContext(DbContextOptions<InventoryDbContext> options) : base(options)
    {
    }

    public DbSet<StockItem> StockItems => Set<StockItem>();
    public DbSet<StockReservation> StockReservations => Set<StockReservation>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<StockItem>(entity =>
        {
            entity.ToTable("stock_items");
            entity.HasKey(e => e.ProductId);
            entity.Property(e => e.ProductId).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Sku).HasMaxLength(64).IsRequired();
            entity.HasIndex(e => e.Sku).IsUnique();
            entity.Property(e => e.AvailableQuantity).IsRequired();
            entity.Property(e => e.ReservedQuantity).IsRequired();
            entity.Property(e => e.UpdatedAt).IsRequired();
        });

        modelBuilder.Entity<StockReservation>(entity =>
        {
            entity.ToTable("stock_reservations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasMaxLength(64).IsRequired();
            entity.Property(e => e.OrderId).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Sku).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Quantity).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(32).IsRequired();
            entity.Property(e => e.ExpiresAt).IsRequired();
            entity.Property(e => e.CreatedAt).IsRequired();
            entity.Property(e => e.UpdatedAt).IsRequired();
            entity.HasIndex(e => e.OrderId);
            entity.HasIndex(e => e.Status);
        });
    }
}
