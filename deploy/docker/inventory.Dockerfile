FROM mcr.microsoft.com/dotnet/sdk:11.0 AS build
WORKDIR /src
COPY services/inventory-service/InventoryService.csproj services/inventory-service/
RUN dotnet restore services/inventory-service/InventoryService.csproj
COPY services/inventory-service services/inventory-service
RUN dotnet publish services/inventory-service/InventoryService.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:11.0
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 causalotel
COPY --from=build /app/publish .
USER 10001
EXPOSE 5050
ENTRYPOINT ["dotnet", "InventoryService.dll"]
