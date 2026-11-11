using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace CausalOTel.InventoryService.Security;

/// <summary>
/// H-02: verifies the compact HMAC-SHA256 bearer tokens issued by user-service
/// (and the short-lived service tokens issued by order-service).
/// </summary>
public class TokenValidator
{
    private const string Issuer = "causalotel";
    private const string Prefix = "v1";

    private readonly byte[] _secret;

    public TokenValidator(IConfiguration configuration)
    {
        _secret = TokenSecret.Resolve(configuration);
    }

    public ClaimsPrincipal? Validate(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        string[] parts = token.Split('.');
        if (parts.Length != 3 || parts[0] != Prefix)
        {
            return null;
        }

        byte[] supplied;
        try
        {
            supplied = Base64UrlDecode(parts[2]);
        }
        catch (FormatException)
        {
            return null;
        }

        byte[] expected = Hmac(parts[0] + "." + parts[1]);
        if (!CryptographicOperations.FixedTimeEquals(expected, supplied))
        {
            return null;
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(Base64UrlDecode(parts[1]));
        }
        catch (Exception)
        {
            return null;
        }

        using (document)
        {
            JsonElement root = document.RootElement;
            if (!root.TryGetProperty("iss", out var issuer) || issuer.GetString() != Issuer)
            {
                return null;
            }
            if (!root.TryGetProperty("exp", out var exp) || exp.GetInt64() <= DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            {
                return null;
            }
            if (!root.TryGetProperty("sub", out var sub) || string.IsNullOrWhiteSpace(sub.GetString()))
            {
                return null;
            }
            if (!root.TryGetProperty("role", out var role) || !(role.GetString() ?? string.Empty).StartsWith("ROLE_"))
            {
                return null;
            }

            string username = root.TryGetProperty("username", out var name)
                ? name.GetString() ?? sub.GetString()!
                : sub.GetString()!;

            var identity = new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, sub.GetString()!),
                new Claim(ClaimTypes.Name, username),
                new Claim(ClaimTypes.Role, role.GetString()!)
            }, "Bearer");

            return new ClaimsPrincipal(identity);
        }
    }

    private byte[] Hmac(string input)
    {
        using var mac = new HMACSHA256(_secret);
        return mac.ComputeHash(Encoding.UTF8.GetBytes(input));
    }

    private static byte[] Base64UrlDecode(string value)
    {
        string padded = value.Replace('-', '+').Replace('_', '/');
        padded = (padded.Length % 4) switch
        {
            2 => padded + "==",
            3 => padded + "=",
            _ => padded
        };
        return Convert.FromBase64String(padded);
    }
}
