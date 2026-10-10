#!/usr/bin/env python3
"""Actualiza data/districts a partir del Shapefile oficial de arbolado.

No necesita dependencias externas: lee directamente los ficheros SHP y DBF de
puntos, genera los GeoJSON compactos que consume la web y actualiza el indice.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import struct
import sys
import tempfile
import unicodedata
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT / "data" / "crude-data"
DEFAULT_OUTPUT = ROOT / "data" / "districts"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Regenera los GeoJSON por distrito desde el Shape oficial."
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="Procesa este .shp en vez del inventario de data/crude-data/2025.",
    )
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def find_shapefile(explicit: Path | None, source_dir: Path) -> Path:
    if explicit:
        shp = explicit.resolve()
        if not shp.is_file() or shp.suffix.lower() != ".shp":
            raise ValueError(f"No es un fichero SHP valido: {shp}")
        return shp

    files = sorted(source_dir.resolve().glob("*.shp"))
    if not files:
        raise ValueError(f"No se encontro ningun .shp en {source_dir.resolve()}")
    if len(files) > 1:
        names = ", ".join(p.name for p in files)
        raise ValueError(
            f"Hay varios .shp en {source_dir.resolve()}: {names}. "
            "Indica uno mediante --input."
        )
    return files[0]


def read_dbf(path: Path):
    """Produce registros DBF como diccionarios, conservando poco en memoria."""
    with path.open("rb") as handle:
        header = handle.read(32)
        if len(header) != 32:
            raise ValueError(f"Cabecera DBF invalida: {path}")
        record_count = struct.unpack("<I", header[4:8])[0]
        header_length = struct.unpack("<H", header[8:10])[0]
        record_length = struct.unpack("<H", header[10:12])[0]
        fields = []
        while True:
            descriptor = handle.read(32)
            if not descriptor or descriptor[0] == 0x0D:
                break
            name = descriptor[:11].split(b"\0", 1)[0].decode("ascii")
            fields.append((name, chr(descriptor[11]), descriptor[16], descriptor[17]))

        handle.seek(header_length)
        for _ in range(record_count):
            raw = handle.read(record_length)
            if len(raw) != record_length:
                raise ValueError(f"Registro DBF incompleto en {path}")
            if raw[:1] == b"*":
                yield None
                continue
            offset = 1
            record = {}
            for name, kind, length, decimals in fields:
                text = raw[offset : offset + length].decode("utf-8", "replace").strip()
                offset += length
                if not text:
                    value = None
                elif kind in "NF":
                    try:
                        value = float(text) if decimals or "." in text or "e" in text.lower() else int(text)
                    except ValueError:
                        value = None
                else:
                    value = text
                record[name] = value
            yield record


def read_point_shapes(path: Path):
    """Produce coordenadas de un SHP de puntos (tipos Point/PointZ/PointM)."""
    prj = path.with_suffix(".prj")
    projection = prj.read_text(encoding="utf-8", errors="ignore") if prj.is_file() else ""
    is_utm30 = "UTM_Zone_30N" in projection or "UTM zone 30N" in projection
    with path.open("rb") as handle:
        header = handle.read(100)
        if len(header) != 100 or struct.unpack(">I", header[:4])[0] != 9994:
            raise ValueError(f"Cabecera SHP invalida: {path}")
        while True:
            record_header = handle.read(8)
            if not record_header:
                return
            if len(record_header) != 8:
                raise ValueError(f"Registro SHP incompleto en {path}")
            _, words = struct.unpack(">II", record_header)
            body = handle.read(words * 2)
            shape_type = struct.unpack("<I", body[:4])[0]
            if shape_type == 0:
                yield None
            elif shape_type in (1, 11, 21) and len(body) >= 20:
                x, y = struct.unpack("<dd", body[4:20])
                yield utm30_to_wgs84(x, y) if is_utm30 else (x, y)
            else:
                raise ValueError(
                    f"Geometria SHP no compatible (tipo {shape_type}); se esperaban puntos."
                )


def utm30_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """Convierte ETRS89/UTM 30N a longitud/latitud WGS84 (EPSG:4326)."""
    semi_major = 6378137.0
    eccentricity_sq = 0.00669438002290  # Elipsoide GRS 1980 (ETRS89)
    scale = 0.9996
    x = easting - 500000.0
    y = northing
    meridional_arc = y / scale
    mu = meridional_arc / (
        semi_major
        * (
            1
            - eccentricity_sq / 4
            - 3 * eccentricity_sq**2 / 64
            - 5 * eccentricity_sq**3 / 256
        )
    )
    e1 = (1 - math.sqrt(1 - eccentricity_sq)) / (1 + math.sqrt(1 - eccentricity_sq))
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
        + (151 * e1**3 / 96) * math.sin(6 * mu)
        + (1097 * e1**4 / 512) * math.sin(8 * mu)
    )
    ecc_prime_sq = eccentricity_sq / (1 - eccentricity_sq)
    sin_phi = math.sin(phi1)
    cos_phi = math.cos(phi1)
    tan_phi = math.tan(phi1)
    n1 = semi_major / math.sqrt(1 - eccentricity_sq * sin_phi**2)
    r1 = semi_major * (1 - eccentricity_sq) / (1 - eccentricity_sq * sin_phi**2) ** 1.5
    t1 = tan_phi**2
    c1 = ecc_prime_sq * cos_phi**2
    d = x / (n1 * scale)
    latitude = phi1 - (n1 * tan_phi / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ecc_prime_sq) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ecc_prime_sq - 3 * c1**2)
        * d**6
        / 720
    )
    longitude = math.radians(-3.0) + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ecc_prime_sq + 24 * t1**2)
        * d**5
        / 120
    ) / cos_phi
    return math.degrees(longitude), math.degrees(latitude)


def value(record: dict, *names: str):
    lookup = {key.casefold(): val for key, val in record.items()}
    for name in names:
        found = lookup.get(name.casefold())
        if found is not None:
            return found
    return None


def safe_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return "_".join(text.replace("/", " ").split())


def feature(
    record: dict,
    coordinates: tuple[float, float],
    *,
    latest_inventory: bool = True,
    species_lookup: dict[str, str] | None = None,
) -> dict:
    props = {}
    mappings = (
        ("nb", ("Nbre_Barri", "NBRE_BARRI")),
        ("cn", ("Nombre_com", "NOMBRE_COM", "common_name")),
        ("sn", ("ESPECIE", "Nombre cientifico", "species")),
        ("d", ("PERIMETRO", "diameter")),
        ("h", ("ALTURA_TOT", "height")),
    )
    for short, candidates in mappings:
        item = value(record, *candidates)
        if item not in (None, ""):
            # La fuente publica las especies en mayusculas; mejora su lectura.
            props[short] = item.title() if short == "sn" and isinstance(item, str) else item
    if "sn" not in props and species_lookup:
        species_code = value(record, "Codigo_ESP", "CODIGO_ESP")
        species_data = species_lookup.get(str(species_code or "").strip())
        if species_data:
            if isinstance(species_data, tuple):
                scientific_name, common_name = species_data
                if common_name:
                    props["cn"] = common_name
            else:
                scientific_name = species_data
            if scientific_name:
                # La tabla auxiliar ya usa la capitalización taxonómica correcta.
                props["sn"] = scientific_name
    if not latest_inventory:
        props["li"] = 0
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {
            "type": "Point",
            "coordinates": [round(coordinates[0], 6), round(coordinates[1], 6)],
        },
    }


def shape_records(shp: Path):
    dbf = shp.with_suffix(".dbf")
    if not dbf.is_file():
        raise ValueError(f"Falta el fichero asociado: {dbf}")
    sentinel = object()
    shapes = read_point_shapes(shp)
    records = read_dbf(dbf)
    while True:
        point = next(shapes, sentinel)
        record = next(records, sentinel)
        if point is sentinel and record is sentinel:
            return
        if point is sentinel or record is sentinel:
            raise ValueError(f"SHP y DBF tienen distinto numero de registros: {shp}")
        if point is not None and record is not None:
            yield record, point


def build_merged(base_shp: Path, latest_shp: Path, staging: Path) -> tuple[int, list[dict]]:
    """Combina inventarios por identificador, conservando las bajas aparentes."""
    print(f"Inventario base: {base_shp}")
    print(f"Ultimo inventario: {latest_shp}")
    latest = {}
    species_lookup = {}
    for record, point in shape_records(latest_shp):
        identifier = str(value(record, "ACTIVO_COD", "ASSETNUM") or "").strip()
        if not identifier:
            continue
        latest[identifier] = (record, point)
        code = str(value(record, "Codigo_ESP", "CODIGO_ESP") or "").strip()
        species = str(value(record, "ESPECIE", "species") or "").strip()
        if code and species:
            species_lookup[code] = species

    handles = {}
    counts = defaultdict(int)
    names = {}

    def emit(record: dict, point: tuple[float, float], is_latest: bool) -> None:
        code = str(value(record, "Num_Dto", "NUM_DTO") or "99").strip().zfill(2)
        name = str(value(record, "Nbre_Dto", "NBRE_DTO") or "OTROS MUNICIPIOS").strip()
        names[code] = name
        filename = f"district_{code}_{safe_name(name)}.geojson"
        if code not in handles:
            handle = (staging / filename).open("w", encoding="utf-8", newline="")
            handles[code] = (handle, filename)
            handle.write('{"type":"FeatureCollection","properties":')
            handle.write(json.dumps({"district_code": code, "district_name": name}, ensure_ascii=False, separators=(",", ":")))
            handle.write(',"features":[')
        handle, _ = handles[code]
        if counts[code]:
            handle.write(",")
        json.dump(
            feature(record, point, latest_inventory=is_latest, species_lookup=species_lookup),
            handle,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        counts[code] += 1

    seen_base = set()
    retained_only_in_base = 0
    common = 0
    for base_record, base_point in shape_records(base_shp):
        identifier = str(value(base_record, "ASSETNUM", "ACTIVO_COD") or "").strip()
        if not identifier or identifier in seen_base:
            continue
        seen_base.add(identifier)
        current = latest.pop(identifier, None)
        if current:
            emit(*current, True)
            common += 1
        else:
            emit(base_record, base_point, False)
            retained_only_in_base += 1

    additions = len(latest)
    for current_record, current_point in latest.values():
        emit(current_record, current_point, True)

    for handle, _ in handles.values():
        handle.write("]}")
        handle.close()

    districts = []
    for code in sorted(counts):
        _, filename = handles[code]
        path = staging / filename
        districts.append({
            "code": code,
            "name": names[code],
            "filename": filename,
            "tree_count": counts[code],
            "size_mb": path.stat().st_size / 1024 / 1024,
        })
    total = sum(counts.values())
    print(
        f"Coincidentes: {common:,}; solo base: {retained_only_in_base:,}; "
        f"altas del ultimo inventario: {additions:,}"
    )
    return total, districts


def build(
    shp: Path, staging: Path, species_lookup: dict[str, tuple[str, str]] | None = None
) -> tuple[int, list[dict]]:
    dbf = shp.with_suffix(".dbf")
    if not dbf.is_file():
        raise ValueError(f"Falta el fichero asociado: {dbf}")

    handles = {}
    counts = defaultdict(int)
    names = {}
    total = 0
    try:
        sentinel = object()
        shapes = read_point_shapes(shp)
        records = read_dbf(dbf)
        while True:
            point = next(shapes, sentinel)
            record = next(records, sentinel)
            if point is sentinel and record is sentinel:
                break
            if point is sentinel or record is sentinel:
                raise ValueError("SHP y DBF tienen distinto numero de registros")
            if point is None or record is None:
                continue

            code = str(value(record, "Num_Dto", "NUM_DTO") or "99").strip().zfill(2)
            name = str(value(record, "Nbre_Dto", "NBRE_DTO") or "OTROS MUNICIPIOS").strip()
            names[code] = name
            filename = f"district_{code}_{safe_name(name)}.geojson"
            if code not in handles:
                handle = (staging / filename).open("w", encoding="utf-8", newline="")
                handles[code] = (handle, filename)
                handle.write('{"type":"FeatureCollection","properties":')
                handle.write(json.dumps({"district_code": code, "district_name": name}, ensure_ascii=False, separators=(",", ":")))
                handle.write(',"features":[')
            handle, _ = handles[code]
            if counts[code]:
                handle.write(",")
            json.dump(
                feature(record, point, species_lookup=species_lookup),
                handle,
                ensure_ascii=False,
                separators=(",", ":"),
            )
            counts[code] += 1
            total += 1
    finally:
        for handle, _ in handles.values():
            if not handle.closed:
                handle.write("]}")
                handle.close()

    districts = []
    for code in sorted(counts):
        _, filename = handles[code]
        path = staging / filename
        districts.append({
            "code": code,
            "name": names[code],
            "filename": filename,
            "tree_count": counts[code],
            "size_mb": path.stat().st_size / 1024 / 1024,
        })
    return total, districts


def read_species_lookup(path: Path) -> dict[str, tuple[str, str]]:
    if not path.is_file():
        raise ValueError(f"Falta la tabla de especies de 2025: {path}")
    lookup = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            code = (row.get("Código") or "").strip()
            if code:
                lookup[code] = (
                    (row.get("Nombre científico") or "").strip(),
                    (row.get("Nombre común") or "").strip() or code,
                )
    if not lookup:
        raise ValueError(f"La tabla de especies esta vacia: {path}")
    return lookup


def publish(staging: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    for old in output.glob("district_*.geojson"):
        old.unlink()
    for generated in staging.iterdir():
        shutil.move(str(generated), output / generated.name)


def preserve_singular_trees(output: Path, staging: Path) -> dict | None:
    """Copia la capa singular existente, que no forma parte del Shape general."""
    matches = sorted(output.glob("district_22_*.geojson"))
    if not matches:
        return None
    if len(matches) > 1:
        raise ValueError("Hay mas de una capa district_22 en el directorio de salida")

    source = matches[0]
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
        properties = data["properties"]
        count = len(data["features"])
        code = str(properties.get("district_code", "22")).zfill(2)
        name = str(properties.get("district_name", "ARBOLES SINGULARES"))
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Capa de arboles singulares invalida: {source}") from exc

    target = staging / source.name
    shutil.copy2(source, target)
    return {
        "code": code,
        "name": name,
        "filename": source.name,
        "tree_count": count,
        "size_mb": target.stat().st_size / 1024 / 1024,
    }


def main() -> int:
    args = parse_args()
    try:
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        base_dir = args.source_dir.resolve() / "2025"
        if args.input:
            shp = find_shapefile(args.input, args.source_dir)
            species_lookup = None
            print(f"Fuente: {shp}")
        elif base_dir.is_dir():
            shp = find_shapefile(None, base_dir)
            species_lookup = read_species_lookup(base_dir / "CODIGOS_ESPECIES_NOMBRE_CIENT.csv")
            print(f"Fuente: {shp}")
        else:
            shp = find_shapefile(None, args.source_dir)
            species_lookup = None
            print(f"Fuente: {shp}")
        with tempfile.TemporaryDirectory(prefix="madtrees-", dir=output.parent) as tmp:
            staging = Path(tmp)
            total, districts = build(shp, staging, species_lookup)
            if not total or not districts:
                raise ValueError("La fuente no contiene arboles validos")
            singular = preserve_singular_trees(output, staging)
            if singular:
                districts.append(singular)
                districts.sort(key=lambda district: district["code"])
                total += singular["tree_count"]
            index = {
                "total_trees": total,
                "total_districts": len([d for d in districts if d["code"] != "99"]),
                "districts": districts,
            }
            (staging / "districts_index.json").write_text(
                json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            publish(staging, output)
        print(f"Actualizacion completada: {total:,} arboles en {len(districts)} capas")
        print(f"Salida: {output}")
        return 0
    except (OSError, ValueError, struct.error) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
