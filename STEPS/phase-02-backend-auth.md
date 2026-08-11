# Phase 2: Backend, Authentication & Identity

## Objective
Establish the Spring Boot backend service, database connectivity (PostgreSQL), player entity management, and JWT-based authentication.

## Detailed Tasks
1. **Spring Boot Project Scaffolding**
   - Initialize `backend/` using Spring Boot (Web, Security, Data JPA, PostgreSQL Driver, WebSocket).
   - Configure application properties for PostgreSQL connection and JWT secret management.
2. **Database Schema Setup**
   - Implement migrations (Flyway or Hibernate ddl-auto for dev) for `players` and `sessions` tables.
   - Define Player entity:
     - UUID, email, password hash, display name, created, last login, role, avatar, student id, experience, level.
3. **Authentication API Endpoints**
   - Implement `POST /api/v1/auth/register` (password hashing with BCrypt).
   - Implement `POST /api/v1/auth/login` (issuing signed JWT tokens).
   - Configure Spring Security filter chain to protect secured endpoints via JWT.
   - Set up httpOnly cookie storage strategy or secure bearer token transmission.
4. **Testing & Validation**
   - Write unit and integration tests for user registration, duplicate email handling, and JWT validation.
