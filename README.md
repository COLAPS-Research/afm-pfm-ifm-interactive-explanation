# Modelingo

## Deployment issues

1. nginx.conf not working as expected
2. might require to change permissions on specific directories to make logging work

## Quick Start

1. Create a new directory and navigate into it:
```bash
mkdir modelingo && cd modelingo
```

2. Download the docker-compose.yml:
```bash
curl -O https://raw.githubusercontent.com/blueberryhub92/afm-pfm-ifm-interactive-explanation/main/docker-compose.yml
```

3. Start the application:
```bash
docker compose up -d
```

4. Access the application:
- Frontend: http://localhost:8080
- Backend API: http://localhost:3001

## Data Storage
The application stores data in two local directories:
- `./data`: Application data
- `./backups`: Automatic backups