#!/bin/bash
# Abrir NeuroChat por primera vez en Mac
# Ejecuta este archivo UNA VEZ después de arrastrar NeuroChat a Aplicaciones.
# Desde la segunda vez puedes abrir NeuroChat directamente.

APP="/Applications/NeuroChat.app"

if [ ! -d "$APP" ]; then
  echo ""
  echo "  NeuroChat no está en /Applications."
  echo "  Arrastra NeuroChat.app a la carpeta Aplicaciones y"
  echo "  luego vuelve a ejecutar este archivo."
  echo ""
  read -p "  Pulsa Enter para cerrar..."
  exit 1
fi

echo ""
echo "  Eliminando restricción de Gatekeeper..."
xattr -rd com.apple.quarantine "$APP" 2>/dev/null
echo "  Abriendo NeuroChat..."
open "$APP"
echo "  Listo. Puedes cerrar esta ventana."
echo ""
