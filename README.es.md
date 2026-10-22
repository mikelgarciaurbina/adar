<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="Logo de Adar">
</p>

<h1 align="center">Adar</h1>

<p align="center">
  <b>Cliente Git visual y rápido para cualquier repositorio, público o privado.</b><br>
  GitHub, GitLab, Bitbucket, Azure DevOps o tu propio servidor.
</p>

<p align="center"><a href="https://adargit.com/es">adargit.com</a> · <a href="https://adargit.com/es/hoja-de-ruta">Hoja de ruta</a> · <a href="README.md">Read in English</a></p>

> *Adar* significa **rama** —y también **cuerna**— en euskera. El logo es las dos cosas: una cornamenta dibujada con carriles de git.

![Captura de Adar](docs/screenshot.png)

Adar usa el `git` instalado en tu equipo, así que trabaja con las mismas credenciales que ya usas en la terminal:
claves SSH, llavero de macOS, `gh auth`, helpers de credenciales, Git LFS y hooks. Sin cuentas, sin servidores
intermedios y sin límites sobre qué repositorios puedes abrir. Cuando git necesita un usuario, un token o la passphrase
de una clave SSH, Adar te lo pide en un diálogo y git lo guarda con tu helper de credenciales habitual.

La experiencia de uso está inspirada en GitKraken, pero Adar es un proyecto independiente y desarrollado desde cero:
no contiene código, recursos ni marca de GitKraken y no tiene relación con GitKraken ni con Axosoft.

## Funcionalidades

- **Grafo de commits** con carriles de colores, avatares, etiquetas de ramas, tags y remotos, nodo `// WIP` y stashes;
  búsqueda por mensaje, autor, SHA, contenido o ruta; scroll fluido en repos de decenas de miles de commits.
- **Arrastrar y soltar** una rama sobre otra para hacer merge, rebase, fast-forward o push.
- **Panel izquierdo**: ramas locales y remotas agrupadas en carpetas, tags, stashes y submódulos, con filtro,
  contadores ahead/behind y ocultar o aislar ramas en el grafo.
- **Staging** por archivo, por hunk o por líneas sueltas; descartar cambios; ignorar archivos.
- **Commits**: resumen + descripción, amend, “stage all & commit”, mensaje de merge pre-rellenado y **editar el mensaje
  de cualquier commit de tu rama** desde el propio panel (con aviso y atajo de force push si ya estaba pusheado).
- **Diffs** unificados o lado a lado, solo los cambios o el archivo completo, con resaltado de sintaxis y cambios dentro
  de la línea; diff de imágenes; historial de un archivo y *blame*.
- **Herramienta de conflictos** (A / B / resultado editable) y banner para continuar, saltar o abortar merges, rebases,
  cherry-picks y reverts.
- **Rebase interactivo visual**: pick, reword, edit, squash, fixup, drop y reordenar arrastrando.
- **Remotos**: fetch (también en segundo plano), pull (ff-only / merge / rebase), push con upstream, force-push con lease,
  gestión de remotos y clonado con progreso.
- **Deshacer / rehacer** acciones git (checkout, commits, ramas, tags, resets, stashes…).
- **Grupos de pestañas**: mantén juntos los repositorios de un proyecto (por ejemplo api, app y landing) bajo una
  etiqueta con nombre y color; pliégalos y vuelve a abrir el grupo entero con un clic desde la pantalla de inicio, el
  menú **+** o la paleta.
- **Paleta de comandos** (⌘P), **consola git** integrada (⌃\`), pestañas para varios repos, temas oscuro y claro, atajos.
- **Actualizaciones** desde GitHub Releases (*Adar → Check for Updates…*).
- **Seguro por defecto**: las acciones destructivas piden confirmación y se pueden deshacer, y los repositorios cuya
  configuración haría que git ejecute comandos (hooks, `core.fsmonitor`, helpers de credenciales…) solo se abren si
  confías en ellos.

## Descarga

Descarga la versión para tu sistema desde la [página de Releases](https://github.com/mikelgarciaurbina/adar/releases/latest)
(o desde [adargit.com](https://adargit.com/es#descarga)). La app de macOS está firmada y notarizada por Apple; el
instalador de Windows aún no está firmado, así que en Windows la primera vez hace falta un paso más.

### macOS

`Adar-<versión>-arm64.dmg` (o `.zip`), hecha para **Macs con Apple Silicon** (M1 o posterior); los Mac con Intel no
están soportados.

Abre el `.dmg` y arrastra **Adar** a **Aplicaciones**. Adar está firmada con un Developer ID de Apple y notarizada,
así que la primera vez macOS solo pregunta si quieres abrir una app descargada de Internet: pulsa **Abrir**. A partir
de ahí, Adar se actualiza sola (*Adar → Check for Updates…*).

Requisitos: un macOS reciente con Apple Silicon y Git 2.26+ (`xcode-select --install` o `brew install git`).

### Windows

`Adar-<versión>-win-x64.exe`, para Windows 10 y 11 de 64 bits. Ejecútalo: instala Adar para tu usuario (sin permisos
de administrador) y la añade al menú Inicio. El instalador aún no está firmado, así que la primera vez SmartScreen
puede decir "Windows protegió su PC"; pulsa **Más información** y luego **Ejecutar de todas formas**.

Requisitos: Git for Windows 2.26+ ([git-scm.com](https://git-scm.com/downloads/win) o `winget install Git.Git`).

### Linux

`Adar-<versión>-linux-x86_64.AppImage` para casi cualquier distribución, o `Adar-<versión>-linux-amd64.deb` para
Debian, Ubuntu y derivadas (solo x64). Desde la carpeta donde lo hayas descargado:

```bash
chmod +x Adar-<versión>-linux-x86_64.AppImage && ./Adar-<versión>-linux-x86_64.AppImage
# o bien
sudo apt install ./Adar-<versión>-linux-amd64.deb
```

Requisitos: Git 2.26+ de tu gestor de paquetes (`sudo apt install git`…); el AppImage también necesita FUSE 2
(`libfuse2`).

En Windows y Linux, Adar te avisa cuando sale una versión nueva, y su botón **Download** abre la página de la versión:
ejecuta el nuevo instalador, sustituye el AppImage o instala el nuevo `.deb`.

## Línea de comandos

Abre un repositorio en Adar desde la terminal, como `code .` o el `gk` de GitKraken:

```bash
adar              # el repositorio de la carpeta actual
adar ~/code/app   # cualquier carpeta dentro de un repositorio
adar ~/code/shop  # una carpeta con varios repositorios: los abre como grupo de pestañas
```

Instala el comando una vez desde **Adar → Install Command Line Tool…** (o *Settings → Integrations*). Enlaza `adar`
en `/opt/homebrew/bin` o `/usr/local/bin` (solo pide tu contraseña si ninguno es escribible). Si Adar ya está abierta,
el repositorio se abre en una pestaña nueva. También puedes soltar una carpeta sobre el icono de Adar en el Dock.

## Desarrollo

```bash
git clone https://github.com/mikelgarciaurbina/adar.git
cd adar
npm install
npm run dev        # app de escritorio con recarga en caliente
npm run web        # la misma interfaz en el navegador: abre la URL http://127.0.0.1:5898/#t=… que imprime
npm run typecheck
npm test           # tests unitarios y de integración sobre repos git temporales
npm run dist       # genera release/Adar-<versión>-arm64.dmg y .zip
npm run dist:win   # instalador de Windows x64 (release/Adar-<versión>-win-x64.exe)
npm run dist:linux # AppImage y .deb de Linux x64
```

La arquitectura, las convenciones y las herramientas de test (incluidas las pruebas guionizadas de la app real) están
en [AGENTS.md](AGENTS.md). El flujo para contribuir está en [CONTRIBUTING.md](CONTRIBUTING.md).

### Publicar una versión

Al subir un tag `v*`, GitHub Actions compila la app para macOS, Windows y Linux y publica una release; las copias
instaladas la detectan con el actualizador integrado:

```bash
npm version 0.4.0   # actualiza package.json y crea el tag v0.4.0
git push origin main --tags
```

## Roadmap

Multi-idioma (inglés, castellano y euskera), integración con pull requests, el instalador de Windows firmado,
worktrees y más: consulta [ROADMAP.md](ROADMAP.md).

## Licencia

[MIT](LICENSE) © Mikel García
