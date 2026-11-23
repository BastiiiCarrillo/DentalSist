# DentalSis - Sistema de Gestión Clínica Dental Segura (SGCD)

Sistema de gestión clínica odontológica desarrollado con arquitectura defensiva conforme a los estándares OWASP Top 10 y normativas chilenas de derechos del paciente.

## Requisitos Previos

- Node.js v20.x o superior (desarrollado y verificado en Node.js v24)
- npm v10.x o superior
- Conexión a Internet para la base de datos PostgreSQL Serverless en la nube (Neon.tech)

## Guía de Instalación Rápida

### 1. Clonar el repositorio
```bash
git clone https://github.com/BastiiiCarrillo/DentalSist.git
cd DentalSist/backend
```

### 2. Instalar Dependencias (Requirements)
```bash
npm install
```

### 3. Configuración de Variables de Entorno (.env)
En la carpeta `backend/`, crear el archivo `.env` tomando como base `.env.example`:
```bash
cp .env.example .env
```
Verificar que contenga las credenciales asignadas para la evaluación (cadena TLS de Neon Cloud, claves JWT y AES-256).

### 4. Ejecutar Pruebas Unitarias y de Seguridad
Para verificar la suite completa de 30 pruebas unitarias y de integración:
```bash
npm run test:unit
```

### 5. Iniciar la Aplicación
```bash
npm start
```
El servidor quedará operativo en `http://localhost:3000`.

## Accesos del Sistema

- Portal Pacientes (Agendamiento y Citas): `http://localhost:3000/paciente`
- Portal Especialistas (Agenda, Fichas y Recetas): `http://localhost:3000/especialista`
- Autenticación Centralizada: `http://localhost:3000/login`
- Verificación de Salud del Servidor: `http://localhost:3000/api/salud`
