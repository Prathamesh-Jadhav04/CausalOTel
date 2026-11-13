using System;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace CausalOTel.InventoryService.Security;

/// <summary>H-02: resolves the shared HMAC signing secret for bearer tokens.</summary>
public static class TokenSecret
{
    public const string DevOnlyFallback =
        "causalotel-local-dev-only-token-secret-do-not-use-in-production";

    public static byte[] Resolve(IConfiguration configuration)
    {
        string? value = configuration["auth:token:secret"]
            ?? configuration["AUTH_TOKEN_SECRET"]
            ?? Environment.GetEnvironmentVariable("AUTH_TOKEN_SECRET");

        if (string.IsNullOrWhiteSpace(value))
        {
            value = DevOnlyFallback;
        }
        if (value.Length < 32)
        {
            throw new InvalidOperationException("AUTH_TOKEN_SECRET must be at least 32 characters");
        }
        return Encoding.UTF8.GetBytes(value);
    }
}
