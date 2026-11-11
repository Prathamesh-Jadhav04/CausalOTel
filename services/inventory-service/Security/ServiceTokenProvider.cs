using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace CausalOTel.InventoryService.Security;

/// <summary>H-02: issues short-lived signed tokens for service-to-service calls.</summary>
public class ServiceTokenProvider
{
    private const string Issuer = "causalotel";
    private const string Prefix = "v1";

    private readonly byte[] _secret;

    public ServiceTokenProvider(IConfiguration configuration)
    {
        _secret = TokenSecret.Resolve(configuration);
    }

    public string CreateServiceToken()
    {
        return CreateToken("inventory-service", "inventory-service", "ROLE_SERVICE", 300);
    }

    public string CreateToken(string subject, string username, string role, long ttlSeconds)
    {
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payload = new Dictionary<string, object>
        {
            ["iss"] = Issuer,
            ["sub"] = subject,
            ["username"] = username,
            ["role"] = role,
            ["iat"] = now,
            ["exp"] = now + ttlSeconds
        };

        string encodedPayload = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(payload));
        string signingInput = Prefix + "." + encodedPayload;
        return signingInput + "." + Base64UrlEncode(Hmac(signingInput));
    }

    private byte[] Hmac(string input)
    {
        using var mac = new HMACSHA256(_secret);
        return mac.ComputeHash(Encoding.UTF8.GetBytes(input));
    }

    private static string Base64UrlEncode(byte[] value)
    {
        return Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
