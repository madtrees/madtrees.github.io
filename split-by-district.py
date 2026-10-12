#!/usr/bin/env python3
"""
Script para dividir el archivo GeoJSON de árboles por distritos de Madrid.
Crea un archivo separado por cada distrito para carga dinámica.
"""

import json
import os
import sys
import hashlib
from collections import defaultdict

def split_by_district(input_file, output_dir='data/districts'):
    """
    Divide el GeoJSON por distritos.
    
    Args:
        input_file: Ruta al archivo GeoJSON original
        output_dir: Directorio donde guardar los archivos por distrito
    """
    print(f"📖 Leyendo {input_file}...")
    
    if not os.path.exists(input_file):
        print(f"❌ Error: No se encuentra el archivo {input_file}")
        return False
    
    # Mostrar tamaño original
    original_size = os.path.getsize(input_file) / (1024 * 1024)
    print(f"📦 Tamaño original: {original_size:.2f} MB")
    
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Error al leer el archivo: {e}")
        return False
    
    if 'features' not in data or not isinstance(data['features'], list):
        print("❌ Error: Formato de GeoJSON inválido")
        return False
    
    total_trees = len(data['features'])
    print(f"🌳 Total de árboles: {total_trees:,}")
    
    # Agrupar por distrito
    print("\n📊 Agrupando árboles por distrito...")
    districts = defaultdict(list)
    no_district = []
    
    for feature in data['features']:
        props = feature.get('properties', {})
        district_code = props.get('NUM_DTO', '').strip()
        district_name = props.get('NBRE_DTO', '').strip()
        
        if district_code and district_name:
            # Usar código de distrito como clave
            key = f"{district_code}_{district_name}"
            districts[key].append(feature)
        else:
            no_district.append(feature)
    
    # Crear directorio de salida
    os.makedirs(output_dir, exist_ok=True)
    print(f"📁 Creando archivos en: {output_dir}/")
    
    # Guardar cada distrito en un archivo separado
    district_info = []
    total_saved = 0
    
    for district_key, features in sorted(districts.items()):
        district_code = district_key.split('_')[0]
        district_name = '_'.join(district_key.split('_')[1:])
        
        # Crear GeoJSON para este distrito
        district_geojson = {
            'type': 'FeatureCollection',
            'properties': {
                'district_code': district_code,
                'district_name': district_name,
                'tree_count': len(features)
            },
            'features': features
        }
        
        # Nombre de archivo seguro
        safe_name = district_name.replace(' ', '_').replace('/', '_')
        filename = f"district_{district_code}_{safe_name}.geojson"
        filepath = os.path.join(output_dir, filename)
        
        # Guardar archivo
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(district_geojson, f, ensure_ascii=False, separators=(',', ':'))
        
        file_size = os.path.getsize(filepath) / (1024 * 1024)
        total_saved += len(features)
        
        district_info.append({
            'code': district_code,
            'name': district_name,
            'filename': filename,
            'tree_count': len(features),
            'size_mb': file_size
        })
        
        print(f"  ✅ {district_code} - {district_name}: {len(features):,} árboles ({file_size:.2f} MB)")
    
    # Guardar árboles sin distrito (si hay)
    if no_district:
        district_geojson = {
            'type': 'FeatureCollection',
            'properties': {
                'district_code': '00',
                'district_name': 'Sin distrito',
                'tree_count': len(no_district)
            },
            'features': no_district
        }
        
        filepath = os.path.join(output_dir, 'district_00_sin_distrito.geojson')
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(district_geojson, f, ensure_ascii=False, separators=(',', ':'))
        
        file_size = os.path.getsize(filepath) / (1024 * 1024)
        total_saved += len(no_district)
        
        district_info.append({
            'code': '00',
            'name': 'Sin distrito',
            'filename': 'district_00_sin_distrito.geojson',
            'tree_count': len(no_district),
            'size_mb': file_size
        })
        
        print(f"  ⚠️  00 - Sin distrito: {len(no_district):,} árboles ({file_size:.2f} MB)")
    
    # Crear archivo de índice con metadatos
    index_file = os.path.join(output_dir, 'districts_index.json')
    version_hash = hashlib.sha256()
    for info in sorted(district_info, key=lambda item: item['filename']):
        district_path = os.path.join(output_dir, info['filename'])
        version_hash.update(info['filename'].encode('utf-8'))
        with open(district_path, 'rb') as district_file:
            version_hash.update(district_file.read())

    index_data = {
        'data_version': version_hash.hexdigest()[:16],
        'total_trees': total_trees,
        'total_districts': len(districts),
        'districts': district_info
    }
    
    with open(index_file, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ División completada!")
    print(f"📂 Archivos creados: {len(district_info)}")
    print(f"🌳 Árboles guardados: {total_saved:,} de {total_trees:,}")
    print(f"📋 Índice creado: {index_file}")
    
    # Calcular tamaño total
    total_size = sum(info['size_mb'] for info in district_info)
    print(f"📦 Tamaño total de archivos: {total_size:.2f} MB")
    print(f"📉 Tamaño promedio por distrito: {total_size/len(district_info):.2f} MB")
    
    # Mostrar estadísticas
    print("\n📊 Estadísticas:")
    max_district = max(district_info, key=lambda x: x['tree_count'])
    min_district = min(district_info, key=lambda x: x['tree_count'])
    print(f"  🏆 Distrito con más árboles: {max_district['name']} ({max_district['tree_count']:,})")
    print(f"  📍 Distrito con menos árboles: {min_district['name']} ({min_district['tree_count']:,})")
    
    return True

def main():
    input_file = 'trees.geojson'
    output_dir = 'data/districts'
    
    # Procesar argumentos
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--input' and i + 1 < len(args):
            input_file = args[i + 1]
            i += 2
        elif args[i] == '--output' and i + 1 < len(args):
            output_dir = args[i + 1]
            i += 2
        elif args[i] in ['--help', '-h']:
            print_help()
            return
        else:
            print(f"❌ Argumento desconocido: {args[i]}")
            print_help()
            return
    
    # Ejecutar división
    split_by_district(input_file, output_dir)

def print_help():
    print("""
🌳 Divisor de GeoJSON por Distritos - Madtrees

Uso:
    python split-by-district.py [opciones]

Opciones:
    --input <archivo>     Archivo GeoJSON de entrada (default: trees.geojson)
    --output <directorio> Directorio de salida (default: data/districts)
    --help, -h            Mostrar esta ayuda

Ejemplo:
    python split-by-district.py
    python split-by-district.py --input trees.geojson --output data/districts

Resultado:
    - Crea un archivo .geojson por cada distrito de Madrid
    - Crea districts_index.json con metadatos
    - Todos los archivos en la carpeta especificada
    """)

if __name__ == '__main__':
    main()
