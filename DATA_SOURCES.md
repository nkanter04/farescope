# Airport and demo route data

The airport catalog was imported on 2026-11-17 from [OurAirports](https://github.com/davidmegginson/ourairports-data).
It includes airports marked as offering scheduled service with three-letter IATA codes, excludes closed airports and heliports, and retains the original curated city labels for saved-search compatibility.
OurAirports provides its data in the public domain. Country names and continents also come from this source.
The existing country cost indexes remain mock-price inputs. Additional countries use the neutral illustrative value 1.

The demo route adjacency file, [routes.json](apps/api/src/providers/data/routes.json), is derived from the [OpenFlights route database](https://openflights.org/data).
That source last received route updates in June 2014. This snapshot supports simulated nonstop and connecting itineraries and cannot establish current schedules or availability.
Only directed routes with zero intermediate stops and airports present in the imported catalog are retained. Duplicate airline entries are collapsed into destination lists.
The derived route database is available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/), with individual contents under the [Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1-0/).
The route database is committed in full and can be downloaded with this repository.

To regenerate, download these files into a local directory and run the import script from the repository root.

- OurAirports [airports.csv](https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv)
- OurAirports [countries.csv](https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/countries.csv)
- OpenFlights [routes.dat](https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat), saved as routes.csv

```powershell
./scripts/import-airports.ps1 -SourceDirectory /path/to/downloads
```

Live search uses itineraries returned by the flight provider. The demo graph is used only by the mock provider.
