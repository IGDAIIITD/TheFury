@echo off
cd /d "%~dp0backend"
if exist backend.log del backend.log
if exist backend.log.err del backend.log.err
start "" /b java -jar target\campusforge-backend-0.0.1-SNAPSHOT.jar > backend.log 2> backend.log.err
echo backend-launched
