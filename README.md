# News Aggregator

A modern news aggregation platform built with Laravel and React that pulls articles from multiple sources and presents them in a clean, user-friendly interface.

## Features

- 🔐 User authentication and registration
- 🔍 Advanced article search and filtering
- 📱 Mobile-responsive design
- 🎯 Personalized news feed based on user preferences
- 📰 Multiple news sources integration (NewsAPI, Guardian, NY Times)
- ⚡ Real-time updates with scheduled article fetching
- 🎨 Clean and modern UI with Tailwind CSS

## Prerequisites

- Docker and Docker Compose (for containerized setup)
- PHP 8.2+ (for local setup)
- Composer (for local setup)
- Node.js 18+ (for local setup)
- PostgreSQL 15+ (for local setup)

## Quick Start with Docker

1. Clone the repository:
```bash
git clone https://github.com/harlleybastos/news-aggregator.git
cd news-aggregator
```

2. Create environment files:
```bash
# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env
```

3. Start the Docker containers:
```bash
docker-compose up -d
```

4. Install backend dependencies:
```bash
docker-compose exec backend composer install
```

5. Generate application key:
```bash
docker-compose exec backend php artisan key:generate
```

6. Run database migrations and seed initial data:
```bash
docker-compose exec backend php artisan migrate:fresh
docker-compose exec backend php artisan db:seed --class=TestDataSeeder
```

7. Install frontend dependencies:
```bash
docker-compose exec frontend npm install
```

The application should now be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

## Local Setup (Without Docker)

1. Clone the repository and set up backend:
```bash
git clone https://github.com/harlleybastos/news-aggregator.git
cd news-aggregator/backend

composer install
cp .env.example .env
php artisan key:generate
```

2. Configure your database in `.env` and run migrations:
```bash
php artisan migrate:fresh
php artisan db:seed --class=TestDataSeeder
```

3. Set up the frontend:
```bash
cd ../frontend
npm install
cp .env.example .env
```

4. Start the development servers:
```bash
# In backend directory
php artisan serve

# In frontend directory
npm start
```

## Environment Variables

### Backend (.env)
```env
APP_NAME=NewsAggregator
APP_ENV=local
APP_KEY=base64:8OPF8MCmpShxRhnE9og6OY57DQ+0hAor/xq1dD0zXWc=
APP_DEBUG=true
APP_URL=http://localhost:8000

DB_CONNECTION=pgsql
DB_HOST=db
DB_PORT=5432
DB_DATABASE=news_aggregator
DB_USERNAME=news_user
DB_PASSWORD=news_password

# News API Keys
NEWSAPI_KEY=1c4e1c03b15543a28548362200cb2ee3
GUARDIAN_API_KEY=9656ef5d-69a5-420b-a1e4-cd7ea852c0ea
NYTIMES_API_KEY=KrUAIw9lrLkn5nHPes8EbfxcOW5g4tGo

# Additional configurations
SESSION_DRIVER=database
QUEUE_CONNECTION=database
CACHE_STORE=database
```

### Frontend (.env)
```env
REACT_APP_API_URL=http://localhost:8000/api/v1
```

## Fetching News Articles

The application uses scheduled commands to fetch articles. You can manually trigger the fetch:

```bash
# Docker
docker-compose exec backend php artisan news:fetch

# Local
php artisan news:fetch
```

To view the status of fetched articles:
```bash
php artisan news:status
```

## API Documentation

### Authentication Endpoints

- POST `/api/v1/register` - Register a new user
- POST `/api/v1/login` - Login user
- POST `/api/v1/logout` - Logout user (requires authentication)

### Articles Endpoints

- GET `/api/v1/articles` - List all articles with filtering options
- GET `/api/v1/articles/{id}` - Get single article
- GET `/api/v1/feed` - Get personalized news feed (requires authentication)

### User Preferences Endpoints

- GET `/api/v1/preferences` - Get user preferences
- PUT `/api/v1/preferences` - Update user preferences

## Available Commands

```bash
# Fetch news articles
php artisan news:fetch

# Check news data status
php artisan news:status

# Clean up old articles (older than 30 days)
php artisan news:cleanup
```

## Testing

```bash
# Backend tests
docker-compose exec backend php artisan test

# Frontend tests
docker-compose exec frontend npm test
```

## Troubleshooting

1. If the frontend can't connect to the backend:
   - Check if the backend is running
   - Verify CORS settings in `backend/config/cors.php`
   - Ensure the API URL is correctly set in frontend `.env`

2. If articles aren't being fetched:
   - Verify API keys in backend `.env`
   - Check the Laravel logs: `storage/logs/laravel.log`
   - Run `php artisan news:status` to check data status

3. Database connection issues:
   - Ensure PostgreSQL is running
   - Check database credentials in `.env`
   - Try running `php artisan migrate:fresh`

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/my-new-feature`
5. Submit a pull request

## License

This project is open-sourced software licensed under the MIT license.