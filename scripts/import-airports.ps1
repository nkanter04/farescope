param([Parameter(Mandatory = $true)][string]$SourceDirectory)
$ErrorActionPreference = 'Stop'
# Input files are the unmodified OurAirports airports/countries CSVs and OpenFlights routes.dat.
$outputDirectory = Join-Path $PSScriptRoot '../packages/shared/src/data'
$routeDirectory = Join-Path $PSScriptRoot '../apps/api/src/providers/data'
New-Item -ItemType Directory -Force $outputDirectory, $routeDirectory | Out-Null
$airports = @(Import-Csv (Join-Path $SourceDirectory 'airports.csv') |
    Where-Object { $_.scheduled_service -eq 'yes' -and $_.iata_code -cmatch '^[A-Z]{3}$' -and $_.type -in @('large_airport', 'medium_airport', 'small_airport') } |
    Sort-Object iata_code, ident |
    Group-Object iata_code | ForEach-Object {
        $airport = $_.Group | Sort-Object @{ Expression = { @('large_airport', 'medium_airport', 'small_airport').IndexOf($_.type) } }, ident | Select-Object -First 1
        $city = $airport.municipality
        if (-not $city) { $city = $airport.name }
        [ordered]@{ iata = $airport.iata_code; name = $airport.name; city = $city; country = $airport.iso_country
            lat = [double]::Parse($airport.latitude_deg, [cultureinfo]::InvariantCulture)
            lng = [double]::Parse($airport.longitude_deg, [cultureinfo]::InvariantCulture) }
    })
$codes = @{}
foreach ($airport in $airports) { $codes[$airport.iata] = $true }
$countries = @(Import-Csv (Join-Path $SourceDirectory 'countries.csv') | ForEach-Object {
    [ordered]@{ code = $_.code; name = $_.name; continent = $_.continent }
})
$routes = [ordered]@{}
Import-Csv (Join-Path $SourceDirectory 'routes.csv') -Header airline,airlineId,origin,originId,destination,destinationId,codeshare,stops,equipment |
    Where-Object { $_.stops -eq '0' -and $codes.ContainsKey($_.origin) -and $codes.ContainsKey($_.destination) -and $_.origin -ne $_.destination } |
    Group-Object origin | Sort-Object Name | ForEach-Object { $routes[$_.Name] = @($_.Group.destination | Sort-Object -Unique) }
function Write-JsonRows($Path, $Rows) {
    $lines = @($Rows | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress -Depth 5 })
    $newline = [Environment]::NewLine
    [IO.File]::WriteAllText($Path, '[' + $newline + ($lines -join (',' + $newline)) + $newline + ']' + $newline)
}
Write-JsonRows (Join-Path $outputDirectory 'airports.json') $airports
Write-JsonRows (Join-Path $outputDirectory 'countries.json') $countries
$routeLines = @($routes.Keys | ForEach-Object { (ConvertTo-Json $_ -Compress) + ': ' + (ConvertTo-Json -InputObject $routes[$_] -Compress) })
$newline = [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $routeDirectory 'routes.json'), '{' + $newline + ($routeLines -join (',' + $newline)) + $newline + '}' + $newline)
Write-Output "$($airports.Count) airports, $($countries.Count) countries and territories, $($routes.Count) route origins"
