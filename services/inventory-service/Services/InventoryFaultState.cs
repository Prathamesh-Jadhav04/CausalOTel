namespace CausalOTel.InventoryService.Services;

public class InventoryFaultState
{
    public int LatencyMs { get; set; } = 0;
    public bool SimulateBusy { get; set; } = false;
    public bool SimulateError { get; set; } = false;
    public string? ErrorMessage { get; set; } = null;

    public void Reset()
    {
        LatencyMs = 0;
        SimulateBusy = false;
        SimulateError = false;
        ErrorMessage = null;
    }
}
