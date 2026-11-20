# Star catalog attribution

`stars.json` derives from David Nash / Astronexus's [HYG Database v4.1](https://github.com/astronexus/HYG-Database/tree/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg/CURRENT) under the [Creative Commons Attribution-ShareAlike 4.0 International license](https://creativecommons.org/licenses/by-sa/4.0/). This JSON adaptation uses the same license.

The build filters the [v4.1 CSV](https://raw.githubusercontent.com/astronexus/HYG-Database/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg/CURRENT/hygdata_v41.csv) to Hipparcos entries at visual magnitude 7.5 or brighter, keeps seven fields, converts right ascension from hours to degrees, sorts by magnitude, and encodes the result as JSON. The original catalog combines Hipparcos, Yale Bright Star and Gliese data. HYG coordinates are epoch and equinox J2000.0.

Run `python3 scripts/space/build_star_catalog.py path/to/hygdata_v41.csv` to regenerate the subset.
