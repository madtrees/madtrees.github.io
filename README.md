# 🌳 Interactive Tree Map - Tutorial

Create an interactive web map to visualize trees in your city using open data. This project was originally built for Madrid's ~790,000 trees, but you can adapt it for any city.

## 📋 What You'll Need

- A GeoJSON file with tree locations from your city's open data portal
- Python 3 installed on your computer
- Git installed
- A GitHub account (free)
- Basic command line knowledge

## 🚀 Step-by-Step Tutorial

### Step 1: Clone This Project

Open your terminal and run:

```bash
git clone https://github.com/YOUR_USERNAME/madtrees.git
cd madtrees
```

Or download and extract the ZIP file from GitHub.

### Step 2: Get Your City's Tree Data

1. Find your city's open data portal
2. Look for datasets about "trees", "urban forestry", or "green spaces"
3. Download the data in **GeoJSON format** (or convert from CSV/Shapefile)
4. Place the file in the project folder and name it `trees.geojson`

**Example data portals:**
- Madrid: https://datos.madrid.es/
- Barcelona: https://opendata-ajuntament.barcelona.cat/
- New York: https://opendata.cityofnewyork.us/
- London: https://data.london.gov.uk/

### Step 3: Optimize Your Data

Large GeoJSON files (>100 MB) won't work on GitHub. Use the optimization script:

**Windows (PowerShell):**
```powershell
python optimize-geojson.py
```

**Linux/Mac:**
```bash
python3 optimize-geojson.py
```

This script will:
- Remove unnecessary fields
- Reduce file size significantly
- Create `trees-data.geojson`

```

**Alternative: Split by districts**

For very large datasets (>200k trees), split into smaller files by district:

```bash
python split-by-district.py
```

This creates one file per district in `data/districts/` folder.

**Then compress the district files:**

```bash
python compress-districts.py
```

This removes redundant fields and shortens property names, reducing file sizes by ~18%. When deployed, GitHub Pages automatically applies gzip compression (additional ~88% reduction), so users download only **~22 MB** instead of 184 MB.

### Step 4: Replace the Original File

After optimizing, replace the original file:

**Windows (PowerShell):**
```powershell
Remove-Item trees.geojson
Rename-Item trees-data.geojson trees.geojson
```

**Linux/Mac:**
```bash
rm trees.geojson
mv trees-data.geojson trees.geojson
```

### Step 5: Test Locally

Before uploading, test the map on your computer from your local project folder:

**Windows (PowerShell):**
```powershell
python -m http.server 8000
```

**Linux/Mac:**
```bash
python3 -m http.server 8000
```

Open your browser and go to: http://localhost:8000

You should see your tree map! Press `Ctrl+C` in the terminal to stop the server.

### Step 6: Initialize Git Repository

```bash
git init
git add .
git commit -m "Initial commit: City trees map"
```

### Step 7: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: choose a name (e.g., `barcelona-trees`, `london-trees`)
3. Make it **Public** (required for free GitHub Pages)
4. **Do NOT** check "Initialize with README" (you already have one)
5. Click **Create repository**

### Step 8: Upload to GitHub

Replace `YOUR_USERNAME` and `your-repo-name` with your values:

```bash
git remote add origin https://github.com/YOUR_USERNAME/your-repo-name.git
git branch -M main
git push -u origin main
```

**If the file is too large for GitHub:**

Use Git LFS (Large File Storage):

```bash
git lfs install
git lfs track "*.geojson"
git add .gitattributes
git add .
git commit -m "Add large files with LFS"
git push -u origin main
```

### Step 9: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (top right)
3. Scroll down and click **Pages** (left sidebar)
4. Under **Source**, select:
   - Branch: `main`
   - Folder: `/ (root)`
5. Click **Save**
6. Wait 2-3 minutes for deployment

### Step 10: View Your Map!

Your map will be live at:

```
https://YOUR_USERNAME.github.io/your-repo-name/
```

Share this URL with anyone!

## 🎨 Customize Your Map

### Change the City Name and Center

Edit `map.js` line 1:

```javascript
// Change coordinates [latitude, longitude] and zoom level to center your city
const map = L.map('map').setView([40.4168, -3.7038], 12);
```

Find your city's coordinates on Google Maps (right-click > coordinates).

### Change Page Title

Edit `index.html` line 7:

```html
<title>Your City Trees - Interactive Map</title>
```

### Adjust Tree Data Fields

If your data has different field names, edit `map.js` around lines 120-125:

```javascript
const species = props.species || props."YOUR_FIELD_NAME" || "Unknown";
```

## 📦 Project Structure

```
your-project/
├── index.html              # Main web page
├── map.js                  # Map logic and interactivity
├── trees.geojson           # Your tree data (optimized)
├── optimize-geojson.py     # Script to reduce file size
├── split-by-district.py    # Script to split data by districts
└── README.md               # This file
```

## 🛠️ Script Reference

### optimize-geojson.py

Optimizes GeoJSON files by removing unnecessary fields and reducing size.

**Basic usage:**
```bash
python optimize-geojson.py
```

**Options:**
```bash
--input <file>          Input GeoJSON file (default: trees.geojson)
--output <file>         Output file (default: trees-data.geojson)
--keep-ratio <0.0-1.0>  Keep percentage of trees (1.0=100%, 0.5=50%)
```

**Examples:**
```bash
# Keep all trees, just optimize fields
python optimize-geojson.py

# Keep 50% of trees
python optimize-geojson.py --keep-ratio 0.5

# Custom input/output files
python optimize-geojson.py --input mydata.geojson --output optimized.geojson
```

### split-by-district.py

Splits large GeoJSON files into smaller files by district for better performance.

**Basic usage:**
```bash
python split-by-district.py
```

**Options:**
```bash
--input <file>       Input GeoJSON file (default: trees.geojson)
--output <folder>    Output folder (default: data/districts)
```

**Example:**
```bash
python split-by-district.py --input trees.geojson --output data/districts
```

This creates:
- One `.geojson` file per district
- `districts_index.json` with metadata

**Note:** If using district splitting, you need to modify `map.js` to load districts dynamically (code already included in the current version).

### compress-districts.py

After splitting, compress district files to reduce download size by removing redundant fields and shortening property names.

**Basic usage:**
```bash
python compress-districts.py
```

This script:
- Removes internal fields (ASSETNUM, NUM_DTO, NUM_BARRIO)
- Shortens property names (e.g., "Nombre científico" → "sn")
- Reduces file size by ~18%
- Files compress further with gzip when served (GitHub Pages automatically applies ~88% compression)

**Example results:**
- Uncompressed on disk: 184 MB → User downloads with gzip: **~22 MB**

**When to use:** After running `split-by-district.py`, always run `compress-districts.py` before deploying to optimize download speeds.

## 🐛 Troubleshooting

### "GitHub file size limit exceeded"

**Solution:** Your file is too large (>100 MB).

1. Run the optimizer:
   ```bash
   python optimize-geojson.py
   ```
2. Or use Git LFS (see Step 8)
3. Or split by districts (see `split-by-district.py`)

### Map doesn't load / blank page

**Solution:**

1. Check browser console (F12) for errors
2. Verify `trees.geojson` exists in the project root
3. Make sure GeoJSON is valid (use https://geojson.io/ to check)
4. Test locally first with `python -m http.server`

### "CORS error" when testing locally

**Solution:** Don't open `index.html` directly (file://).

Always use a local server:
```bash
python -m http.server 8000
```

### Map is very slow

**Solution:** Too many trees for the browser.

Split by districts for dynamic loading

### Trees don't show up on the map

**Solution:** Field names might be different.

1. Open your `trees.geojson` in a text editor
2. Look at the "properties" section of the first feature
3. Update field names in `map.js` (lines 120-140)

## 📊 Performance Tips

**Recommended file sizes:**
- Small cities (<50,000 trees): < 50 MB
- Medium cities (50k-200k trees): 50-100 MB
- Large cities (>200k trees): Use district splitting

**Expected loading times:**
- 20 MB file: 2-5 seconds
- 50 MB file: 5-10 seconds
- 100 MB file: 10-30 seconds

## 🔄 Updating Your Data

When you have new data:

1. Replace `trees.geojson` with the new file
2. Optimize it:
   ```bash
   python optimize-geojson.py
   rm trees.geojson
   mv trees-data.geojson trees.geojson
   ```
3. Commit and push:
   ```bash
   git add trees.geojson
   git commit -m "Update tree data"
   git push
   ```
4. Wait 1-2 minutes for GitHub Pages to update

## 📄 License

This project is open source. Tree data belongs to the community.

## 🤝 Need Help?

- Open an issue on GitHub
- Check existing issues for solutions
- Read the code comments in `map.js` and `index.html`

## 🌍 Examples

Projects using this template:
- Madrid Trees: https://github.com/YOUR_USERNAME/madtrees
- (Add your city here!)

---

## Final touch
Change the favicon to one that represents your city

**Happy mapping! 🗺️🌳**
