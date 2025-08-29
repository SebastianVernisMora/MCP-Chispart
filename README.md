# MCP-Chispart 🚀

![Banner](https://img.shields.io/badge/MCP--Chispart-Agentes%20en%20acci%C3%B3n-1e88e5?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Estado Beta](https://img.shields.io/badge/Estado-Beta-orange.svg)]() [![Hecho con ❤️](https://img.shields.io/badge/Hecho%20con-%E2%9D%A4-red.svg)]()

## 📝 Descripción

MCP-Chispart es un entorno de ejemplo para coordinar agentes MCP mediante un orquestador y adaptadores sencillos. Permite crear tareas, enrutar eventos y experimentar con proveedores externos como Blackbox o Codestral.

## 🚀 Características

- Orquestador en `scripts/chispart-mcp/orchestrator.mjs` con persistencia de tareas.
- Wrapper `chispart_mcp.sh` para inicializar el entorno y ejecutar comandos.
- Adaptadores de ejemplo: coordinator, qa, blackbox y mistral.
- Estado persistente en `.mcp/state` y mailboxes en `.mcp/mailboxes`.

## 📦 Instalación

1. Clona el repositorio.
2. Copia `.env.example` a `.env` y coloca tus claves.
3. Ejecuta `./chispart_mcp.sh init` para preparar mailboxes y estado.

## 📚 Uso

Consulta el [Manual de Comandos](COMMANDS.md) para ver todos los comandos disponibles. Un flujo mínimo sería:

```bash
./chispart_mcp.sh agents
./chispart_mcp.sh task "Investigar error de login" Yega-API
./chispart_mcp.sh pump
```

## 🤝 Contribuciones

¡Las contribuciones son bienvenidas! Abre un issue o un pull request con tus propuestas.

## 📄 Licencia

Este proyecto se distribuye bajo la licencia [MIT](LICENSE).

---
**Sebastian Vernis | Soluciones Digitales**

