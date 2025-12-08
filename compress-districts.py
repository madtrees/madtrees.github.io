#!/usr/bin/env python3
"""
Compress district GeoJSON files by:
1. Shortening property names
2. Removing null/empty values
3. Rounding coordinates to 6 decimal places (~11cm precision)
4. Converting to compact JSON format
"""

import json
import os
from pathlib import Path

# Property name mapping (long -> short)
# Use None to remove fields completely
PROPERTY_MAP = {
    "Nombre científico": "sn",  # scientific name
    "CODIGO_ESP": "cn",          # common name
    "diameter": "d",
    "height": "h",
    "NBRE_DTO": "dt",            # district
    "NBRE_BARRI": "nb",          # neighborhood
    "species": "sn",
    "common_name": "cn",
    "ASSETNUM": None,            # Remove - internal ID not needed for display
    "NUM_DTO": None,             # Remove - duplicate of dt
    "NUM_BARRIO": None           # Remove - internal barrio number
}

def compress_properties(props):
    """Compress property names and remove null/empty values"""
    if not props:
        return {}
    
    compressed = {}
    for key, value in props.items():
        # Skip null or empty values
        if value is None or value == "":
            continue
        
        # Check if this field should be removed
        if key in PROPERTY_MAP:
            short_key = PROPERTY_MAP[key]
            # If mapped to None, skip this field entirely
            if short_key is None:
                continue
        else:
            # Keep original key if not in map
            short_key = key
        
        compressed[short_key] = value
    
    return compressed

def round_coordinates(coords, precision=6):
    """Round coordinates to specified decimal places"""
    if isinstance(coords[0], list):
        return [round_coordinates(c, precision) for c in coords]
    return [round(c, precision) for c in coords]

def compress_geojson(input_path, output_path):
    """Compress a single GeoJSON file"""
    print(f"Compressing {input_path.name}...")
    
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Process features
    if 'features' in data:
        for feature in data['features']:
            # Compress properties
            if 'properties' in feature:
                feature['properties'] = compress_properties(feature['properties'])
            
            # Round coordinates
            if 'geometry' in feature and feature['geometry']:
                if 'coordinates' in feature['geometry']:
                    feature['geometry']['coordinates'] = round_coordinates(
                        feature['geometry']['coordinates']
                    )
    
    # Write compressed JSON (no whitespace)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
    
    # Calculate size reduction
    original_size = input_path.stat().st_size
    compressed_size = output_path.stat().st_size
    reduction = (1 - compressed_size / original_size) * 100
    
    print(f"  Original: {original_size:,} bytes")
    print(f"  Compressed: {compressed_size:,} bytes")
    print(f"  Reduction: {reduction:.1f}%")
    
    return original_size, compressed_size

def main():
    script_dir = Path(__file__).parent
    districts_dir = script_dir / 'data' / 'districts'
    
    if not districts_dir.exists():
        print(f"Error: Districts directory not found: {districts_dir}")
        return
    
    # Get all district GeoJSON files
    geojson_files = sorted(districts_dir.glob('district_*.geojson'))
    
    if not geojson_files:
        print("No district GeoJSON files found!")
        return
    
    print(f"Found {len(geojson_files)} district files to compress\n")
    
    total_original = 0
    total_compressed = 0
    
    for input_file in geojson_files:
        output_file = input_file  # Overwrite the original
        orig, comp = compress_geojson(input_file, output_file)
        total_original += orig
        total_compressed += comp
        print()
    
    # Summary
    total_reduction = (1 - total_compressed / total_original) * 100
    print("=" * 60)
    print("COMPRESSION SUMMARY")
    print("=" * 60)
    print(f"Total original size: {total_original:,} bytes ({total_original/1024/1024:.2f} MB)")
    print(f"Total compressed size: {total_compressed:,} bytes ({total_compressed/1024/1024:.2f} MB)")
    print(f"Total reduction: {total_reduction:.1f}%")
    print(f"Space saved: {(total_original - total_compressed)/1024/1024:.2f} MB")

if __name__ == '__main__':
    main()
