# Campus Forge Setup Guide

This folder contains database migration/seed dumps and setup instructions for deploying Campus Forge on a new machine.

---

## Prerequisites

1. **Java (JDK 21+)**
2. **Maven 3.9+**
3. **Node.js (v18+) & npm**
4. **PostgreSQL 15+**

---

## 1. Database Setup

1. Start your PostgreSQL service and ensure you can create databases.
2. Create the `campusforge` database and user:
   ```bash
   createdb campusforge
   ```
3. Restore the database from the included dump:
   ```bash
   psql -d campusforge -f campusforge_dump.sql
   ```

---

## 2. Backend Setup (Spring Boot)

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```
2. Update database credentials in `src/main/resources/application.properties` if needed.
3. Compile and package the application:
   ```bash
   mvn clean package -DskipTests
   ```
4. Run the backend server:
   ```bash
   java -jar target/campusforge-backend-0.0.1-SNAPSHOT.jar &
   ```
   The backend will run on port **17172**.

---

## 3. Frontend Setup (Player Web App - PWA)

1. Navigate to the `web-client/` directory:
   ```bash
   cd web-client
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite dev server:
   ```bash
   npm run dev -- --host
   ```
   The PWA will run on port **17170**.
