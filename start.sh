#!/bin/bash
# TuraQuant - Startup Script
# Usage: ./start.sh [backend|frontend|admin|all]

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPONENT=${1:-all}

start_backend() {
    echo "Starting Backend (FastAPI) on port 8000..."
    cd "$PROJECT_DIR/backend"
    source venv/bin/activate
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
    echo "Backend PID: $!"
}

start_frontend() {
    echo "Starting Frontend (React) on port 3000..."
    cd "$PROJECT_DIR/frontend"
    npm start &
    echo "Frontend PID: $!"
}

start_admin() {
    echo "Starting Admin Panel (React) on port 3001..."
    cd "$PROJECT_DIR/admin"
    npm start &
    echo "Admin PID: $!"
}

case $COMPONENT in
    backend)
        start_backend
        ;;
    frontend)
        start_frontend
        ;;
    admin)
        start_admin
        ;;
    all)
        start_backend
        sleep 3
        start_frontend
        start_admin
        echo ""
        echo "==========================================="
        echo "  TuraQuant"
        echo "==========================================="
        echo "  Backend API:  http://localhost:8000"
        echo "  API Docs:     http://localhost:8000/docs"
        echo "  Frontend:     http://localhost:3000"
        echo "  Admin Panel:  http://localhost:3001"
        echo "==========================================="
        echo "  Default Admin: admin@tura.com / Admin@123"
        echo "==========================================="
        ;;
    *)
        echo "Usage: ./start.sh [backend|frontend|admin|all]"
        exit 1
        ;;
esac

wait
