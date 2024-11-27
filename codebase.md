# backend/.editorconfig

```
root = true

[*]
charset = utf-8
end_of_line = lf
indent_size = 4
indent_style = space
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[*.{yml,yaml}]
indent_size = 2

[docker-compose.yml]
indent_size = 4

```

# backend/.gitattributes

```
* text=auto eol=lf

*.blade.php diff=html
*.css diff=css
*.html diff=html
*.md diff=markdown
*.php diff=php

/.github export-ignore
CHANGELOG.md export-ignore
.styleci.yml export-ignore

```

# backend/.gitignore

```
/.phpunit.cache
/node_modules
/public/build
/public/hot
/public/storage
/storage/*.key
/storage/pail
/vendor
.env
.env.backup
.env.production
.phpactor.json
.phpunit.result.cache
Homestead.json
Homestead.yaml
auth.json
npm-debug.log
yarn-error.log
/.fleet
/.idea
/.nova
/.vscode
/.zed

```

# backend/app/Console/Commands/CheckNewsDataCommand.php

```php
<?php
namespace App\Console\Commands;

use App\Models\Article;
use App\Models\Source;
use Illuminate\Console\Command;

class CheckNewsDataCommand extends Command
{
    protected $signature = 'news:status';
    protected $description = 'Check status of news data';

    public function handle()
    {
        $articleCount = Article::count();
        $sourceCount = Source::count();
        $lastUpdate = Article::latest('created_at')->first()?->created_at;

        $this->table(['Metric', 'Value'], [
            ['Total Articles', $articleCount],
            ['Total Sources', $sourceCount],
            ['Last Update', $lastUpdate ? $lastUpdate->diffForHumans() : 'Never'],
        ]);

        if ($articleCount === 0) {
            $this->warn('No articles found. You should run: php artisan news:fetch');
        }

        return 0;
    }
}

```

# backend/app/Console/Commands/CleanupNewsCommand.php

```php
<?php

namespace App\Console\Commands;

use App\Models\Article;
use Illuminate\Console\Command;

class CleanupNewsCommand extends Command
{
    protected $signature = 'news:cleanup';
    protected $description = 'Clean up old news articles';

    public function handle()
    {
        $this->info('Starting news cleanup...');

        try {
            $cutoffDate = now()->subDays(30);
            $count = Article::where('published_at', '<', $cutoffDate)->delete();

            $this->info("Successfully deleted {$count} old articles");
        } catch (\Exception $e) {
            $this->error('Error cleaning up news: ' . $e->getMessage());
            return 1;
        }

        return 0;
    }
}

```

# backend/app/Console/Commands/FetchNewsCommand.php

```php
<?php
namespace App\Console\Commands;
use App\Models\Article;
use App\Services\NewsService;
use Illuminate\Console\Command;

class FetchNewsCommand extends Command
{
    protected $signature = 'news:fetch {--force : Force fetch even if recent data exists}';
    protected $description = 'Fetch news from all configured sources';

    public function handle(NewsService $newsService)
    {
        try {
            $this->info('Starting news fetch...');

            // Check last fetch time unless --force flag is used
            if (!$this->option('force')) {
                $lastArticle = Article::latest('created_at')->first();

                if ($lastArticle && $lastArticle->created_at->diffInHours(now()) < 1) {
                    $this->info('Recent data exists. Use --force to fetch anyway.');
                    return 0;
                }
            }

            // Fetch from each source
            $newsService->fetchFromNewsApi();
            $this->info('NewsAPI fetch completed');

            $newsService->fetchFromGuardian();
            $this->info('Guardian fetch completed');

            $newsService->fetchFromNYTimes();
            $this->info('NY Times fetch completed');

            $this->info('News fetch completed successfully!');
            return 0;
        } catch (\Exception $e) {
            $this->error('Error fetching news: ' . $e->getMessage());
            return 1;
        }
    }
}

```

# backend/app/Console/Commands/NewsStatusCommand.php

```php
<?php
namespace App\Console\Commands;

use App\Models\Article;
use App\Models\Source;
use Illuminate\Console\Command;

class NewsStatusCommand extends Command
{
    protected $signature = 'news:status';
    protected $description = 'Show status of fetched news data';

    public function handle()
    {
        $this->info('News Data Status:');
        $this->line('----------------');

        // Articles count
        $articlesCount = Article::count();
        $this->info("Total Articles: {$articlesCount}");

        // Sources count
        $sourcesCount = Source::count();
        $this->info("Total Sources: {$sourcesCount}");

        // Latest article
        $latestArticle = Article::latest('published_at')->first();
        if ($latestArticle) {
            $this->info("Latest Article: {$latestArticle->title}");
            $this->info("Published at: {$latestArticle->published_at}");
        }

        // Articles by source
        $this->info("\nArticles by Source:");
        Article::selectRaw('source_id, count(*) as count')
            ->groupBy('source_id')
            ->with('source')
            ->get()
            ->each(function ($item) {
                $this->line("- {$item->source->name}: {$item->count}");
            });

        return 0;
    }
}

```

# backend/app/Console/Kernel.php

```php
<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        // Fetch news every hour
        $schedule->command('news:fetch')->hourly();

        // Clean up old articles weekly
        $schedule->command('news:cleanup')->weekly();

        // Prune expired tokens daily
        $schedule->command('sanctum:prune-expired --hours=24')->daily();
    }

    protected function commands(): void
    {
        $this->load(__DIR__ . '/Commands');

        require base_path('routes/console.php');
    }
}

```

# backend/app/Http/Controllers/Api/ArticleController.php

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ArticleResource;
use App\Models\Article;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;

class ArticleController extends Controller
{
    public function index(Request $request)
    {
        // Check if we have any articles
        if (Article::count() === 0) {
            // No articles found, run the fetch command
            try {
                Log::info('No articles found. Fetching articles for the first time...');
                Artisan::call('news:fetch');
                Log::info('Initial fetch completed successfully.');
            } catch (\Exception $e) {
                Log::error('Initial fetch failed: ' . $e->getMessage());
                return response()->json([
                    'message' => 'Error fetching initial articles',
                    'error' => $e->getMessage()
                ], 500);
            }
        }

        $query = Article::query()->with(['source', 'categories']);

        // Your existing filter logic...
        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhere('content', 'like', "%{$search}%");
            });
        }

        // Date filters
        if ($fromDate = $request->input('from_date')) {
            $query->where('published_at', '>=', $fromDate);
        }
        if ($toDate = $request->input('to_date')) {
            $query->where('published_at', '<=', $toDate);
        }

        // Source filters
        if ($sources = $request->input('sources')) {
            $query->whereIn('source_id', explode(',', $sources));
        }

        // Sort
        $sortBy = $request->input('sort_by', 'published_at');
        $sortOrder = $request->input('sort_order', 'desc');
        $query->orderBy($sortBy, $sortOrder);

        return ArticleResource::collection(
            $query->paginate($request->input('per_page', 15))
        );
    }

    public function userFeed(Request $request)
    {
        $user = $request->user();
        $preferences = $user->preferences;

        $query = Article::query()->with(['source', 'categories']);

        if ($preferences) {
            // Apply category preferences
            if (!empty($preferences->preferred_categories)) {
                $query->whereHas('categories', function ($q) use ($preferences) {
                    $q->whereIn('categories.id', $preferences->preferred_categories);
                });
            }

            // Apply source preferences
            if (!empty($preferences->preferred_sources)) {
                $query->whereIn('source_id', $preferences->preferred_sources);
            }

            // Apply author preferences
            if (!empty($preferences->preferred_authors)) {
                $query->whereIn('author', $preferences->preferred_authors);
            }
        }

        // Apply any additional filters from the request
        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%");
            });
        }

        $query->orderBy('published_at', 'desc');

        return ArticleResource::collection(
            $query->paginate($request->input('per_page', 15))
        );
    }
}

```

# backend/app/Http/Controllers/Api/AuthController.php

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function register(RegisterRequest $request)
    {
        $user = User::create([
            'name' => $request->name,
            'email' => $request->email,
            'password' => Hash::make($request->password),
        ]);

        $token = $user->createToken('auth_token')->plainTextToken;

        return response()->json([
            'user' => $user,
            'token' => $token
        ], 201);
    }

    public function login(LoginRequest $request)
    {
        $user = User::where('email', $request->email)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json([
                'message' => 'Invalid credentials'
            ], 401);
        }

        $token = $user->createToken('auth_token')->plainTextToken;

        return response()->json([
            'user' => $user,
            'token' => $token
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out successfully']);
    }
}

```

# backend/app/Http/Controllers/Api/CategoryController.php

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class CategoryController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        //
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        //
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        //
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id)
    {
        //
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        //
    }
}

```

# backend/app/Http/Controllers/Api/SourceController.php

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class SourceController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        //
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        //
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        //
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id)
    {
        //
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        //
    }
}

```

# backend/app/Http/Controllers/Api/UserPreferenceController.php

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UserPreference\UpdatePreferenceRequest;
use App\Models\Category;
use App\Models\Source;
use App\Models\UserPreference;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class UserPreferenceController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $preferences = $request->user()->preferences;

        // If no preferences exist, create default ones
        if (!$preferences) {
            $preferences = UserPreference::create([
                'user_id' => $request->user()->id,
                'preferred_categories' => [],
                'preferred_sources' => [],
                'preferred_authors' => [],
                'email_notifications' => false,
                'update_frequency' => 'daily'
            ]);
        }

        // Load available options for the frontend
        $data = [
            'preferences' => $preferences,
            'available_categories' => Category::select('id', 'name')->get(),
            'available_sources' => Source::select('id', 'name')->get(),
        ];

        return response()->json($data);
    }

    public function update(UpdatePreferenceRequest $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validated();

        $preferences = $user->preferences;
        if (!$preferences) {
            $preferences = new UserPreference(['user_id' => $user->id]);
        }

        $preferences->fill($validated);
        $preferences->save();

        return response()->json([
            'message' => 'Preferences updated successfully',
            'preferences' => $preferences
        ]);
    }
}

```

# backend/app/Http/Controllers/Controller.php

```php
<?php

namespace App\Http\Controllers;

abstract class Controller
{
    //
}

```

# backend/app/Http/Requests/Auth/LoginRequest.php

```php
<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class LoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ];
    }
}

```

# backend/app/Http/Requests/Auth/RegisterRequest.php

```php
<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ];
    }
}

```

# backend/app/Http/Requests/UserPreference/UpdatePreferenceRequest.php

```php
<?php

namespace App\Http\Requests\UserPreference;

use Illuminate\Foundation\Http\FormRequest;

class UpdatePreferenceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'preferred_categories' => ['nullable', 'array'],
            'preferred_categories.*' => ['exists:categories,id'],
            'preferred_sources' => ['nullable', 'array'],
            'preferred_sources.*' => ['exists:sources,id'],
            'preferred_authors' => ['nullable', 'array'],
            'preferred_authors.*' => ['string'],
        ];
    }
}

```

# backend/app/Http/Resources/ArticleResource.php

```php
<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ArticleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'description' => $this->description,
            'content' => $this->content,
            'author' => $this->author,
            'url' => $this->url,
            'image_url' => $this->image_url,
            'published_at' => $this->published_at,
            'source' => [
                'id' => $this->source->id,
                'name' => $this->source->name,
                'url' => $this->source->url,
            ],
            'categories' => $this->categories->map(fn($category) => [
                'id' => $category->id,
                'name' => $category->name,
                'slug' => $category->slug,
            ]),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}

```

# backend/app/Jobs/FetchNewsArticles.php

```php
<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class FetchNewsArticles implements ShouldQueue
{
    use Queueable;

    /**
     * Create a new job instance.
     */
    public function __construct()
    {
        //
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        //
    }
}

```

# backend/app/Models/Article.php

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
// app/Models/Article.php
use Laravel\Scout\Searchable;

class Article extends Model
{
    use HasFactory, Searchable;

    protected $fillable = [
        'source_id',
        'title',
        'description',
        'content',
        'author',
        'url',
        'image_url',
        'published_at',
        'api_source',
        'api_id'
    ];

    protected $casts = [
        'published_at' => 'datetime'
    ];

    public function toSearchableArray()
    {
        return [
            'title' => $this->title,
            'description' => $this->description,
            'content' => $this->content,
            'author' => $this->author,
        ];
    }

    public function source()
    {
        return $this->belongsTo(Source::class);
    }

    public function categories()
    {
        return $this->belongsToMany(Category::class);
    }
}

```

# backend/app/Models/Category.php

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Category extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'slug'];

    public function articles()
    {
        return $this->belongsToMany(Article::class);
    }
}

```

# backend/app/Models/Source.php

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Source extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'slug',
        'api_id',
        'url',
        'api_source'
    ];

    public function articles()
    {
        return $this->hasMany(Article::class);
    }
}

```

# backend/app/Models/User.php

```php
<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
    ];

    public function preferences()
    {
        return $this->hasOne(UserPreference::class);
    }
}

```

# backend/app/Models/UserPreference.php

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserPreference extends Model
{
    protected $fillable = [
        'user_id',
        'preferred_categories',
        'preferred_sources',
        'preferred_authors'
    ];

    protected $casts = [
        'preferred_categories' => 'array',
        'preferred_sources' => 'array',
        'preferred_authors' => 'array'
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}

```

# backend/app/Providers/AppServiceProvider.php

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}

```

# backend/app/Providers/NewsServiceProvider.php

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class NewsServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        //
    }
}

```

# backend/app/Services/NewsService.php

```php
<?php
namespace App\Services;

use App\Models\Article;
use App\Models\Source;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class NewsService
{
    protected $newsApiKey;
    protected $guardianApiKey;
    protected $nytApiKey;

    public function __construct()
    {
        $this->newsApiKey = config('services.newsapi.key');
        $this->guardianApiKey = config('services.guardian.key');
        $this->nytApiKey = config('services.nytimes.key');

        if (empty($this->newsApiKey)) {
            Log::error('NewsAPI key not configured');
        }
        if (empty($this->guardianApiKey)) {
            Log::error('Guardian API key not configured');
        }
        if (empty($this->nytApiKey)) {
            Log::error('NY Times API key not configured');
        }
    }
    public function fetchFromNewsApi()
    {
        try {
            $categories = ['business', 'technology', 'science', 'health', 'sports'];
            $totalArticles = 0;

            foreach ($categories as $category) {
                $response = Http::get('https://newsapi.org/v2/top-headlines', [
                    'apiKey' => $this->newsApiKey,
                    'language' => 'en',
                    'category' => $category,
                    'pageSize' => 100,
                ]);

                if (!$response->successful()) {
                    Log::error("NewsAPI error for category $category: " . $response->body());
                    continue;
                }

                $data = $response->json();
                if (empty($data['articles'])) {
                    Log::warning("No articles found for category: $category");
                    continue;
                }

                $totalArticles += count($data['articles']);
                $this->processNewsApiArticles($data['articles']);

                // Add a small delay to avoid rate limits
                sleep(1);
            }

            Log::info("NewsAPI: Fetched total of $totalArticles articles from categories");

        } catch (\Exception $e) {
            Log::error('NewsAPI fetch failed: ' . $e->getMessage());
        }
    }

    public function fetchFromGuardian()
    {
        try {
            // Fetch multiple sections
            $sections = ['world', 'business', 'technology', 'science', 'sport'];

            foreach ($sections as $section) {
                $response = Http::get('https://content.guardianapis.com/search', [
                    'api-key' => $this->guardianApiKey,
                    'section' => $section,
                    'show-fields' => 'all',
                    'page-size' => 50,
                    'order-by' => 'newest'
                ]);

                if ($response->successful()) {
                    $articles = $response->json()['response']['results'];
                    $this->processGuardianArticles($articles);
                }
            }
        } catch (\Exception $e) {
            Log::error('Guardian fetch failed: ' . $e->getMessage());
        }
    }

    public function fetchFromNYTimes()
    {
        try {
            // Fetch from multiple sections
            $sections = ['home', 'world', 'science', 'technology', 'health'];

            foreach ($sections as $section) {
                $response = Http::get("https://api.nytimes.com/svc/topstories/v2/{$section}.json", [
                    'api-key' => $this->nytApiKey
                ]);

                if ($response->successful()) {
                    $articles = $response->json()['results'];
                    $this->processNYTimesArticles($articles);
                }
            }
        } catch (\Exception $e) {
            Log::error('NY Times fetch failed: ' . $e->getMessage());
        }
    }
    protected function processNewsApiArticles($articles)
    {
        $processed = 0;
        $skipped = 0;

        foreach ($articles as $articleData) {
            try {
                if (empty($articleData['title']) || empty($articleData['url'])) {
                    $skipped++;
                    continue;
                }

                $source = Source::firstOrCreate(
                    ['api_id' => $articleData['source']['id'] ?? md5($articleData['source']['name'])],
                    [
                        'name' => $articleData['source']['name'],
                        'slug' => Str::slug($articleData['source']['name']),
                        'api_source' => 'newsapi'
                    ]
                );

                Article::updateOrCreate(
                    ['api_id' => md5($articleData['url'])],
                    [
                        'source_id' => $source->id,
                        'title' => $articleData['title'],
                        'description' => $articleData['description'] ?? null,
                        'content' => $articleData['content'] ?? null,
                        'author' => $articleData['author'] ?? null,
                        'url' => $articleData['url'],
                        'image_url' => $articleData['urlToImage'] ?? null,
                        'published_at' => date('Y-m-d H:i:s', strtotime($articleData['publishedAt'])),
                        'api_source' => 'newsapi'
                    ]
                );
                $processed++;
            } catch (\Exception $e) {
                Log::error("Error processing NewsAPI article: " . $e->getMessage());
                $skipped++;
            }
        }

        Log::info("NewsAPI: Processed $processed articles, skipped $skipped");
    }

    protected function processGuardianArticles($articles)
    {
        foreach ($articles as $articleData) {
            $source = Source::firstOrCreate(
                ['api_id' => 'guardian'],
                [
                    'name' => 'The Guardian',
                    'slug' => 'the-guardian',
                    'api_source' => 'guardian',
                    'url' => 'https://www.theguardian.com'
                ]
            );

            Article::updateOrCreate(
                ['api_id' => $articleData['id']],
                [
                    'source_id' => $source->id,
                    'title' => $articleData['webTitle'],
                    'description' => $articleData['fields']['trailText'] ?? null,
                    'content' => $articleData['fields']['bodyText'] ?? null,
                    'author' => $articleData['fields']['byline'] ?? null,
                    'url' => $articleData['webUrl'],
                    'image_url' => $articleData['fields']['thumbnail'] ?? null,
                    'published_at' => date('Y-m-d H:i:s', strtotime($articleData['webPublicationDate'])),
                    'api_source' => 'guardian'
                ]
            );
        }
    }

    protected function processNYTimesArticles($articles)
    {
        foreach ($articles as $articleData) {
            $source = Source::firstOrCreate(
                ['api_id' => 'nytimes'],
                [
                    'name' => 'The New York Times',
                    'slug' => 'the-new-york-times',
                    'api_source' => 'nytimes',
                    'url' => 'https://www.nytimes.com'
                ]
            );

            Article::updateOrCreate(
                ['api_id' => $articleData['url']],
                [
                    'source_id' => $source->id,
                    'title' => $articleData['title'],
                    'description' => $articleData['abstract'],
                    'content' => $articleData['abstract'], // NYT API doesn't provide full content
                    'author' => $articleData['byline'],
                    'url' => $articleData['url'],
                    'image_url' => $articleData['multimedia'][0]['url'] ?? null,
                    'published_at' => date('Y-m-d H:i:s', strtotime($articleData['published_date'])),
                    'api_source' => 'nytimes'
                ]
            );
        }
    }
}

```

# backend/artisan

```
#!/usr/bin/env php
<?php

use Symfony\Component\Console\Input\ArgvInput;

define('LARAVEL_START', microtime(true));

// Register the Composer autoloader...
require __DIR__.'/vendor/autoload.php';

// Bootstrap Laravel and handle the command...
$status = (require_once __DIR__.'/bootstrap/app.php')
    ->handleCommand(new ArgvInput);

exit($status);

```

# backend/bootstrap/app.php

```php
<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        //
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();

```

# backend/bootstrap/cache/.gitignore

```
*
!.gitignore

```

# backend/bootstrap/cache/packages.php

```php
<?php return array (
  'laravel/pail' => 
  array (
    'providers' => 
    array (
      0 => 'Laravel\\Pail\\PailServiceProvider',
    ),
  ),
  'laravel/sail' => 
  array (
    'providers' => 
    array (
      0 => 'Laravel\\Sail\\SailServiceProvider',
    ),
  ),
  'laravel/sanctum' => 
  array (
    'providers' => 
    array (
      0 => 'Laravel\\Sanctum\\SanctumServiceProvider',
    ),
  ),
  'laravel/scout' => 
  array (
    'providers' => 
    array (
      0 => 'Laravel\\Scout\\ScoutServiceProvider',
    ),
  ),
  'laravel/tinker' => 
  array (
    'providers' => 
    array (
      0 => 'Laravel\\Tinker\\TinkerServiceProvider',
    ),
  ),
  'nesbot/carbon' => 
  array (
    'providers' => 
    array (
      0 => 'Carbon\\Laravel\\ServiceProvider',
    ),
  ),
  'nunomaduro/collision' => 
  array (
    'providers' => 
    array (
      0 => 'NunoMaduro\\Collision\\Adapters\\Laravel\\CollisionServiceProvider',
    ),
  ),
  'nunomaduro/termwind' => 
  array (
    'providers' => 
    array (
      0 => 'Termwind\\Laravel\\TermwindServiceProvider',
    ),
  ),
);
```

# backend/bootstrap/cache/services.php

```php
<?php return array (
  'providers' => 
  array (
    0 => 'Illuminate\\Auth\\AuthServiceProvider',
    1 => 'Illuminate\\Broadcasting\\BroadcastServiceProvider',
    2 => 'Illuminate\\Bus\\BusServiceProvider',
    3 => 'Illuminate\\Cache\\CacheServiceProvider',
    4 => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    5 => 'Illuminate\\Concurrency\\ConcurrencyServiceProvider',
    6 => 'Illuminate\\Cookie\\CookieServiceProvider',
    7 => 'Illuminate\\Database\\DatabaseServiceProvider',
    8 => 'Illuminate\\Encryption\\EncryptionServiceProvider',
    9 => 'Illuminate\\Filesystem\\FilesystemServiceProvider',
    10 => 'Illuminate\\Foundation\\Providers\\FoundationServiceProvider',
    11 => 'Illuminate\\Hashing\\HashServiceProvider',
    12 => 'Illuminate\\Mail\\MailServiceProvider',
    13 => 'Illuminate\\Notifications\\NotificationServiceProvider',
    14 => 'Illuminate\\Pagination\\PaginationServiceProvider',
    15 => 'Illuminate\\Auth\\Passwords\\PasswordResetServiceProvider',
    16 => 'Illuminate\\Pipeline\\PipelineServiceProvider',
    17 => 'Illuminate\\Queue\\QueueServiceProvider',
    18 => 'Illuminate\\Redis\\RedisServiceProvider',
    19 => 'Illuminate\\Session\\SessionServiceProvider',
    20 => 'Illuminate\\Translation\\TranslationServiceProvider',
    21 => 'Illuminate\\Validation\\ValidationServiceProvider',
    22 => 'Illuminate\\View\\ViewServiceProvider',
    23 => 'Laravel\\Pail\\PailServiceProvider',
    24 => 'Laravel\\Sail\\SailServiceProvider',
    25 => 'Laravel\\Sanctum\\SanctumServiceProvider',
    26 => 'Laravel\\Scout\\ScoutServiceProvider',
    27 => 'Laravel\\Tinker\\TinkerServiceProvider',
    28 => 'Carbon\\Laravel\\ServiceProvider',
    29 => 'NunoMaduro\\Collision\\Adapters\\Laravel\\CollisionServiceProvider',
    30 => 'Termwind\\Laravel\\TermwindServiceProvider',
    31 => 'App\\Providers\\AppServiceProvider',
    32 => 'App\\Providers\\NewsServiceProvider',
  ),
  'eager' => 
  array (
    0 => 'Illuminate\\Auth\\AuthServiceProvider',
    1 => 'Illuminate\\Cookie\\CookieServiceProvider',
    2 => 'Illuminate\\Database\\DatabaseServiceProvider',
    3 => 'Illuminate\\Encryption\\EncryptionServiceProvider',
    4 => 'Illuminate\\Filesystem\\FilesystemServiceProvider',
    5 => 'Illuminate\\Foundation\\Providers\\FoundationServiceProvider',
    6 => 'Illuminate\\Notifications\\NotificationServiceProvider',
    7 => 'Illuminate\\Pagination\\PaginationServiceProvider',
    8 => 'Illuminate\\Session\\SessionServiceProvider',
    9 => 'Illuminate\\View\\ViewServiceProvider',
    10 => 'Laravel\\Pail\\PailServiceProvider',
    11 => 'Laravel\\Sanctum\\SanctumServiceProvider',
    12 => 'Laravel\\Scout\\ScoutServiceProvider',
    13 => 'Carbon\\Laravel\\ServiceProvider',
    14 => 'NunoMaduro\\Collision\\Adapters\\Laravel\\CollisionServiceProvider',
    15 => 'Termwind\\Laravel\\TermwindServiceProvider',
    16 => 'App\\Providers\\AppServiceProvider',
    17 => 'App\\Providers\\NewsServiceProvider',
  ),
  'deferred' => 
  array (
    'Illuminate\\Broadcasting\\BroadcastManager' => 'Illuminate\\Broadcasting\\BroadcastServiceProvider',
    'Illuminate\\Contracts\\Broadcasting\\Factory' => 'Illuminate\\Broadcasting\\BroadcastServiceProvider',
    'Illuminate\\Contracts\\Broadcasting\\Broadcaster' => 'Illuminate\\Broadcasting\\BroadcastServiceProvider',
    'Illuminate\\Bus\\Dispatcher' => 'Illuminate\\Bus\\BusServiceProvider',
    'Illuminate\\Contracts\\Bus\\Dispatcher' => 'Illuminate\\Bus\\BusServiceProvider',
    'Illuminate\\Contracts\\Bus\\QueueingDispatcher' => 'Illuminate\\Bus\\BusServiceProvider',
    'Illuminate\\Bus\\BatchRepository' => 'Illuminate\\Bus\\BusServiceProvider',
    'Illuminate\\Bus\\DatabaseBatchRepository' => 'Illuminate\\Bus\\BusServiceProvider',
    'cache' => 'Illuminate\\Cache\\CacheServiceProvider',
    'cache.store' => 'Illuminate\\Cache\\CacheServiceProvider',
    'cache.psr6' => 'Illuminate\\Cache\\CacheServiceProvider',
    'memcached.connector' => 'Illuminate\\Cache\\CacheServiceProvider',
    'Illuminate\\Cache\\RateLimiter' => 'Illuminate\\Cache\\CacheServiceProvider',
    'Illuminate\\Foundation\\Console\\AboutCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Cache\\Console\\ClearCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Cache\\Console\\ForgetCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ClearCompiledCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Auth\\Console\\ClearResetsCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ConfigCacheCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ConfigClearCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ConfigShowCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\DbCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\MonitorCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\PruneCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\ShowCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\TableCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\WipeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\DownCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EnvironmentCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EnvironmentDecryptCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EnvironmentEncryptCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EventCacheCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EventClearCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EventListCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Concurrency\\Console\\InvokeSerializedClosureCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\KeyGenerateCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\OptimizeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\OptimizeClearCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\PackageDiscoverCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Cache\\Console\\PruneStaleTagsCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\ClearCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\ListFailedCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\FlushFailedCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\ForgetFailedCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\ListenCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\MonitorCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\PruneBatchesCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\PruneFailedJobsCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\RestartCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\RetryCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\RetryBatchCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\WorkCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\RouteCacheCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\RouteClearCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\RouteListCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\DumpCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Seeds\\SeedCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Console\\Scheduling\\ScheduleFinishCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Console\\Scheduling\\ScheduleListCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Console\\Scheduling\\ScheduleRunCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Console\\Scheduling\\ScheduleClearCacheCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Console\\Scheduling\\ScheduleTestCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Console\\Scheduling\\ScheduleWorkCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Console\\Scheduling\\ScheduleInterruptCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\ShowModelCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\StorageLinkCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\StorageUnlinkCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\UpCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ViewCacheCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ViewClearCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ApiInstallCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\BroadcastingInstallCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Cache\\Console\\CacheTableCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\CastMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ChannelListCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ChannelMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ClassMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ComponentMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ConfigPublishCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ConsoleMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Routing\\Console\\ControllerMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\DocsCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EnumMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EventGenerateCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\EventMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ExceptionMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Factories\\FactoryMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\InterfaceMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\JobMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\JobMiddlewareMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\LangPublishCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ListenerMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\MailMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Routing\\Console\\MiddlewareMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ModelMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\NotificationMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Notifications\\Console\\NotificationTableCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ObserverMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\PolicyMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ProviderMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\FailedTableCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\TableCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Queue\\Console\\BatchesTableCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\RequestMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ResourceMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\RuleMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ScopeMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Seeds\\SeederMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Session\\Console\\SessionTableCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ServeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\StubPublishCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\TestMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\TraitMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\VendorPublishCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Foundation\\Console\\ViewMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'migrator' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'migration.repository' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'migration.creator' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Migrations\\MigrateCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Migrations\\FreshCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Migrations\\InstallCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Migrations\\RefreshCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Migrations\\ResetCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Migrations\\RollbackCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Migrations\\StatusCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Database\\Console\\Migrations\\MigrateMakeCommand' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'composer' => 'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider',
    'Illuminate\\Concurrency\\ConcurrencyManager' => 'Illuminate\\Concurrency\\ConcurrencyServiceProvider',
    'hash' => 'Illuminate\\Hashing\\HashServiceProvider',
    'hash.driver' => 'Illuminate\\Hashing\\HashServiceProvider',
    'mail.manager' => 'Illuminate\\Mail\\MailServiceProvider',
    'mailer' => 'Illuminate\\Mail\\MailServiceProvider',
    'Illuminate\\Mail\\Markdown' => 'Illuminate\\Mail\\MailServiceProvider',
    'auth.password' => 'Illuminate\\Auth\\Passwords\\PasswordResetServiceProvider',
    'auth.password.broker' => 'Illuminate\\Auth\\Passwords\\PasswordResetServiceProvider',
    'Illuminate\\Contracts\\Pipeline\\Hub' => 'Illuminate\\Pipeline\\PipelineServiceProvider',
    'pipeline' => 'Illuminate\\Pipeline\\PipelineServiceProvider',
    'queue' => 'Illuminate\\Queue\\QueueServiceProvider',
    'queue.connection' => 'Illuminate\\Queue\\QueueServiceProvider',
    'queue.failer' => 'Illuminate\\Queue\\QueueServiceProvider',
    'queue.listener' => 'Illuminate\\Queue\\QueueServiceProvider',
    'queue.worker' => 'Illuminate\\Queue\\QueueServiceProvider',
    'redis' => 'Illuminate\\Redis\\RedisServiceProvider',
    'redis.connection' => 'Illuminate\\Redis\\RedisServiceProvider',
    'translator' => 'Illuminate\\Translation\\TranslationServiceProvider',
    'translation.loader' => 'Illuminate\\Translation\\TranslationServiceProvider',
    'validator' => 'Illuminate\\Validation\\ValidationServiceProvider',
    'validation.presence' => 'Illuminate\\Validation\\ValidationServiceProvider',
    'Illuminate\\Contracts\\Validation\\UncompromisedVerifier' => 'Illuminate\\Validation\\ValidationServiceProvider',
    'Laravel\\Sail\\Console\\InstallCommand' => 'Laravel\\Sail\\SailServiceProvider',
    'Laravel\\Sail\\Console\\PublishCommand' => 'Laravel\\Sail\\SailServiceProvider',
    'command.tinker' => 'Laravel\\Tinker\\TinkerServiceProvider',
  ),
  'when' => 
  array (
    'Illuminate\\Broadcasting\\BroadcastServiceProvider' => 
    array (
    ),
    'Illuminate\\Bus\\BusServiceProvider' => 
    array (
    ),
    'Illuminate\\Cache\\CacheServiceProvider' => 
    array (
    ),
    'Illuminate\\Foundation\\Providers\\ConsoleSupportServiceProvider' => 
    array (
    ),
    'Illuminate\\Concurrency\\ConcurrencyServiceProvider' => 
    array (
    ),
    'Illuminate\\Hashing\\HashServiceProvider' => 
    array (
    ),
    'Illuminate\\Mail\\MailServiceProvider' => 
    array (
    ),
    'Illuminate\\Auth\\Passwords\\PasswordResetServiceProvider' => 
    array (
    ),
    'Illuminate\\Pipeline\\PipelineServiceProvider' => 
    array (
    ),
    'Illuminate\\Queue\\QueueServiceProvider' => 
    array (
    ),
    'Illuminate\\Redis\\RedisServiceProvider' => 
    array (
    ),
    'Illuminate\\Translation\\TranslationServiceProvider' => 
    array (
    ),
    'Illuminate\\Validation\\ValidationServiceProvider' => 
    array (
    ),
    'Laravel\\Sail\\SailServiceProvider' => 
    array (
    ),
    'Laravel\\Tinker\\TinkerServiceProvider' => 
    array (
    ),
  ),
);
```

# backend/bootstrap/providers.php

```php
<?php

return [
    App\Providers\AppServiceProvider::class,
    App\Providers\NewsServiceProvider::class,
];

```

# backend/composer.json

```json
{
    "$schema": "https://getcomposer.org/schema.json",
    "name": "laravel/laravel",
    "type": "project",
    "description": "The skeleton application for the Laravel framework.",
    "keywords": ["laravel", "framework"],
    "license": "MIT",
    "require": {
        "php": "^8.2",
        "guzzlehttp/guzzle": "^7.9",
        "laravel/framework": "^11.31",
        "laravel/sanctum": "^4.0",
        "laravel/scout": "^10.11",
        "laravel/tinker": "^2.9"
    },
    "require-dev": {
        "fakerphp/faker": "^1.23",
        "laravel/pail": "^1.1",
        "laravel/pint": "^1.13",
        "laravel/sail": "^1.26",
        "mockery/mockery": "^1.6",
        "nunomaduro/collision": "^8.1",
        "phpunit/phpunit": "^11.0.1"
    },
    "autoload": {
        "psr-4": {
            "App\\": "app/",
            "Database\\Factories\\": "database/factories/",
            "Database\\Seeders\\": "database/seeders/"
        }
    },
    "autoload-dev": {
        "psr-4": {
            "Tests\\": "tests/"
        }
    },
    "scripts": {
        "post-autoload-dump": [
            "Illuminate\\Foundation\\ComposerScripts::postAutoloadDump",
            "@php artisan package:discover --ansi"
        ],
        "post-update-cmd": [
            "@php artisan vendor:publish --tag=laravel-assets --ansi --force"
        ],
        "post-root-package-install": [
            "@php -r \"file_exists('.env') || copy('.env.example', '.env');\""
        ],
        "post-create-project-cmd": [
            "@php artisan key:generate --ansi",
            "@php -r \"file_exists('database/database.sqlite') || touch('database/database.sqlite');\"",
            "@php artisan migrate --graceful --ansi"
        ],
        "dev": [
            "Composer\\Config::disableProcessTimeout",
            "npx concurrently -c \"#93c5fd,#c4b5fd,#fb7185,#fdba74\" \"php artisan serve\" \"php artisan queue:listen --tries=1\" \"php artisan pail --timeout=0\" \"npm run dev\" --names=server,queue,logs,vite"
        ]
    },
    "extra": {
        "laravel": {
            "dont-discover": []
        }
    },
    "config": {
        "optimize-autoloader": true,
        "preferred-install": "dist",
        "sort-packages": true,
        "allow-plugins": {
            "pestphp/pest-plugin": true,
            "php-http/discovery": true
        }
    },
    "minimum-stability": "stable",
    "prefer-stable": true
}

```

# backend/config/app.php

```php
<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Application Name
    |--------------------------------------------------------------------------
    |
    | This value is the name of your application, which will be used when the
    | framework needs to place the application's name in a notification or
    | other UI elements where an application name needs to be displayed.
    |
    */

    'name' => env('APP_NAME', 'Laravel'),

    /*
    |--------------------------------------------------------------------------
    | Application Environment
    |--------------------------------------------------------------------------
    |
    | This value determines the "environment" your application is currently
    | running in. This may determine how you prefer to configure various
    | services the application utilizes. Set this in your ".env" file.
    |
    */

    'env' => env('APP_ENV', 'production'),

    /*
    |--------------------------------------------------------------------------
    | Application Debug Mode
    |--------------------------------------------------------------------------
    |
    | When your application is in debug mode, detailed error messages with
    | stack traces will be shown on every error that occurs within your
    | application. If disabled, a simple generic error page is shown.
    |
    */

    'debug' => (bool) env('APP_DEBUG', false),

    /*
    |--------------------------------------------------------------------------
    | Application URL
    |--------------------------------------------------------------------------
    |
    | This URL is used by the console to properly generate URLs when using
    | the Artisan command line tool. You should set this to the root of
    | the application so that it's available within Artisan commands.
    |
    */

    'url' => env('APP_URL', 'http://localhost'),

    /*
    |--------------------------------------------------------------------------
    | Application Timezone
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default timezone for your application, which
    | will be used by the PHP date and date-time functions. The timezone
    | is set to "UTC" by default as it is suitable for most use cases.
    |
    */

    'timezone' => env('APP_TIMEZONE', 'UTC'),

    /*
    |--------------------------------------------------------------------------
    | Application Locale Configuration
    |--------------------------------------------------------------------------
    |
    | The application locale determines the default locale that will be used
    | by Laravel's translation / localization methods. This option can be
    | set to any locale for which you plan to have translation strings.
    |
    */

    'locale' => env('APP_LOCALE', 'en'),

    'fallback_locale' => env('APP_FALLBACK_LOCALE', 'en'),

    'faker_locale' => env('APP_FAKER_LOCALE', 'en_US'),

    /*
    |--------------------------------------------------------------------------
    | Encryption Key
    |--------------------------------------------------------------------------
    |
    | This key is utilized by Laravel's encryption services and should be set
    | to a random, 32 character string to ensure that all encrypted values
    | are secure. You should do this prior to deploying the application.
    |
    */

    'cipher' => 'AES-256-CBC',

    'key' => env('APP_KEY'),

    'previous_keys' => [
        ...array_filter(
            explode(',', env('APP_PREVIOUS_KEYS', ''))
        ),
    ],

    /*
    |--------------------------------------------------------------------------
    | Maintenance Mode Driver
    |--------------------------------------------------------------------------
    |
    | These configuration options determine the driver used to determine and
    | manage Laravel's "maintenance mode" status. The "cache" driver will
    | allow maintenance mode to be controlled across multiple machines.
    |
    | Supported drivers: "file", "cache"
    |
    */

    'maintenance' => [
        'driver' => env('APP_MAINTENANCE_DRIVER', 'file'),
        'store' => env('APP_MAINTENANCE_STORE', 'database'),
    ],

];

```

# backend/config/auth.php

```php
<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Authentication Defaults
    |--------------------------------------------------------------------------
    |
    | This option defines the default authentication "guard" and password
    | reset "broker" for your application. You may change these values
    | as required, but they're a perfect start for most applications.
    |
    */

    'defaults' => [
        'guard' => env('AUTH_GUARD', 'web'),
        'passwords' => env('AUTH_PASSWORD_BROKER', 'users'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Authentication Guards
    |--------------------------------------------------------------------------
    |
    | Next, you may define every authentication guard for your application.
    | Of course, a great default configuration has been defined for you
    | which utilizes session storage plus the Eloquent user provider.
    |
    | All authentication guards have a user provider, which defines how the
    | users are actually retrieved out of your database or other storage
    | system used by the application. Typically, Eloquent is utilized.
    |
    | Supported: "session"
    |
    */

    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'users',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | User Providers
    |--------------------------------------------------------------------------
    |
    | All authentication guards have a user provider, which defines how the
    | users are actually retrieved out of your database or other storage
    | system used by the application. Typically, Eloquent is utilized.
    |
    | If you have multiple user tables or models you may configure multiple
    | providers to represent the model / table. These providers may then
    | be assigned to any extra authentication guards you have defined.
    |
    | Supported: "database", "eloquent"
    |
    */

    'providers' => [
        'users' => [
            'driver' => 'eloquent',
            'model' => env('AUTH_MODEL', App\Models\User::class),
        ],

        // 'users' => [
        //     'driver' => 'database',
        //     'table' => 'users',
        // ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Resetting Passwords
    |--------------------------------------------------------------------------
    |
    | These configuration options specify the behavior of Laravel's password
    | reset functionality, including the table utilized for token storage
    | and the user provider that is invoked to actually retrieve users.
    |
    | The expiry time is the number of minutes that each reset token will be
    | considered valid. This security feature keeps tokens short-lived so
    | they have less time to be guessed. You may change this as needed.
    |
    | The throttle setting is the number of seconds a user must wait before
    | generating more password reset tokens. This prevents the user from
    | quickly generating a very large amount of password reset tokens.
    |
    */

    'passwords' => [
        'users' => [
            'provider' => 'users',
            'table' => env('AUTH_PASSWORD_RESET_TOKEN_TABLE', 'password_reset_tokens'),
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Password Confirmation Timeout
    |--------------------------------------------------------------------------
    |
    | Here you may define the amount of seconds before a password confirmation
    | window expires and users are asked to re-enter their password via the
    | confirmation screen. By default, the timeout lasts for three hours.
    |
    */

    'password_timeout' => env('AUTH_PASSWORD_TIMEOUT', 10800),

];

```

# backend/config/cache.php

```php
<?php

use Illuminate\Support\Str;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Cache Store
    |--------------------------------------------------------------------------
    |
    | This option controls the default cache store that will be used by the
    | framework. This connection is utilized if another isn't explicitly
    | specified when running a cache operation inside the application.
    |
    */

    'default' => env('CACHE_STORE', 'database'),

    /*
    |--------------------------------------------------------------------------
    | Cache Stores
    |--------------------------------------------------------------------------
    |
    | Here you may define all of the cache "stores" for your application as
    | well as their drivers. You may even define multiple stores for the
    | same cache driver to group types of items stored in your caches.
    |
    | Supported drivers: "array", "database", "file", "memcached",
    |                    "redis", "dynamodb", "octane", "null"
    |
    */

    'stores' => [

        'array' => [
            'driver' => 'array',
            'serialize' => false,
        ],

        'database' => [
            'driver' => 'database',
            'connection' => env('DB_CACHE_CONNECTION'),
            'table' => env('DB_CACHE_TABLE', 'cache'),
            'lock_connection' => env('DB_CACHE_LOCK_CONNECTION'),
            'lock_table' => env('DB_CACHE_LOCK_TABLE'),
        ],

        'file' => [
            'driver' => 'file',
            'path' => storage_path('framework/cache/data'),
            'lock_path' => storage_path('framework/cache/data'),
        ],

        'memcached' => [
            'driver' => 'memcached',
            'persistent_id' => env('MEMCACHED_PERSISTENT_ID'),
            'sasl' => [
                env('MEMCACHED_USERNAME'),
                env('MEMCACHED_PASSWORD'),
            ],
            'options' => [
                // Memcached::OPT_CONNECT_TIMEOUT => 2000,
            ],
            'servers' => [
                [
                    'host' => env('MEMCACHED_HOST', '127.0.0.1'),
                    'port' => env('MEMCACHED_PORT', 11211),
                    'weight' => 100,
                ],
            ],
        ],

        'redis' => [
            'driver' => 'redis',
            'connection' => env('REDIS_CACHE_CONNECTION', 'cache'),
            'lock_connection' => env('REDIS_CACHE_LOCK_CONNECTION', 'default'),
        ],

        'dynamodb' => [
            'driver' => 'dynamodb',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'table' => env('DYNAMODB_CACHE_TABLE', 'cache'),
            'endpoint' => env('DYNAMODB_ENDPOINT'),
        ],

        'octane' => [
            'driver' => 'octane',
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Cache Key Prefix
    |--------------------------------------------------------------------------
    |
    | When utilizing the APC, database, memcached, Redis, and DynamoDB cache
    | stores, there might be other applications using the same cache. For
    | that reason, you may prefix every cache key to avoid collisions.
    |
    */

    'prefix' => env('CACHE_PREFIX', Str::slug(env('APP_NAME', 'laravel'), '_').'_cache_'),

];

```

# backend/config/cors.php

```php
<?php

return [
    'paths' => ['api/*'],
    'allowed_methods' => ['*'],
    'allowed_origins' => ['http://localhost:3000'],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => true,
];

```

# backend/config/database.php

```php
<?php

use Illuminate\Support\Str;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Database Connection Name
    |--------------------------------------------------------------------------
    |
    | Here you may specify which of the database connections below you wish
    | to use as your default connection for database operations. This is
    | the connection which will be utilized unless another connection
    | is explicitly specified when you execute a query / statement.
    |
    */

    'default' => env('DB_CONNECTION', 'sqlite'),

    /*
    |--------------------------------------------------------------------------
    | Database Connections
    |--------------------------------------------------------------------------
    |
    | Below are all of the database connections defined for your application.
    | An example configuration is provided for each database system which
    | is supported by Laravel. You're free to add / remove connections.
    |
    */

    'connections' => [

        'sqlite' => [
            'driver' => 'sqlite',
            'url' => env('DB_URL'),
            'database' => env('DB_DATABASE', database_path('database.sqlite')),
            'prefix' => '',
            'foreign_key_constraints' => env('DB_FOREIGN_KEYS', true),
            'busy_timeout' => null,
            'journal_mode' => null,
            'synchronous' => null,
        ],

        'mysql' => [
            'driver' => 'mysql',
            'url' => env('DB_URL'),
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => env('DB_PORT', '3306'),
            'database' => env('DB_DATABASE', 'laravel'),
            'username' => env('DB_USERNAME', 'root'),
            'password' => env('DB_PASSWORD', ''),
            'unix_socket' => env('DB_SOCKET', ''),
            'charset' => env('DB_CHARSET', 'utf8mb4'),
            'collation' => env('DB_COLLATION', 'utf8mb4_unicode_ci'),
            'prefix' => '',
            'prefix_indexes' => true,
            'strict' => true,
            'engine' => null,
            'options' => extension_loaded('pdo_mysql') ? array_filter([
                PDO::MYSQL_ATTR_SSL_CA => env('MYSQL_ATTR_SSL_CA'),
            ]) : [],
        ],

        'mariadb' => [
            'driver' => 'mariadb',
            'url' => env('DB_URL'),
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => env('DB_PORT', '3306'),
            'database' => env('DB_DATABASE', 'laravel'),
            'username' => env('DB_USERNAME', 'root'),
            'password' => env('DB_PASSWORD', ''),
            'unix_socket' => env('DB_SOCKET', ''),
            'charset' => env('DB_CHARSET', 'utf8mb4'),
            'collation' => env('DB_COLLATION', 'utf8mb4_unicode_ci'),
            'prefix' => '',
            'prefix_indexes' => true,
            'strict' => true,
            'engine' => null,
            'options' => extension_loaded('pdo_mysql') ? array_filter([
                PDO::MYSQL_ATTR_SSL_CA => env('MYSQL_ATTR_SSL_CA'),
            ]) : [],
        ],

        'pgsql' => [
            'driver' => 'pgsql',
            'url' => env('DB_URL'),
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => env('DB_PORT', '5432'),
            'database' => env('DB_DATABASE', 'laravel'),
            'username' => env('DB_USERNAME', 'root'),
            'password' => env('DB_PASSWORD', ''),
            'charset' => env('DB_CHARSET', 'utf8'),
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => 'public',
            'sslmode' => 'prefer',
        ],

        'sqlsrv' => [
            'driver' => 'sqlsrv',
            'url' => env('DB_URL'),
            'host' => env('DB_HOST', 'localhost'),
            'port' => env('DB_PORT', '1433'),
            'database' => env('DB_DATABASE', 'laravel'),
            'username' => env('DB_USERNAME', 'root'),
            'password' => env('DB_PASSWORD', ''),
            'charset' => env('DB_CHARSET', 'utf8'),
            'prefix' => '',
            'prefix_indexes' => true,
            // 'encrypt' => env('DB_ENCRYPT', 'yes'),
            // 'trust_server_certificate' => env('DB_TRUST_SERVER_CERTIFICATE', 'false'),
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Migration Repository Table
    |--------------------------------------------------------------------------
    |
    | This table keeps track of all the migrations that have already run for
    | your application. Using this information, we can determine which of
    | the migrations on disk haven't actually been run on the database.
    |
    */

    'migrations' => [
        'table' => 'migrations',
        'update_date_on_publish' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | Redis Databases
    |--------------------------------------------------------------------------
    |
    | Redis is an open source, fast, and advanced key-value store that also
    | provides a richer body of commands than a typical key-value system
    | such as Memcached. You may define your connection settings here.
    |
    */

    'redis' => [

        'client' => env('REDIS_CLIENT', 'phpredis'),

        'options' => [
            'cluster' => env('REDIS_CLUSTER', 'redis'),
            'prefix' => env('REDIS_PREFIX', Str::slug(env('APP_NAME', 'laravel'), '_').'_database_'),
        ],

        'default' => [
            'url' => env('REDIS_URL'),
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'username' => env('REDIS_USERNAME'),
            'password' => env('REDIS_PASSWORD'),
            'port' => env('REDIS_PORT', '6379'),
            'database' => env('REDIS_DB', '0'),
        ],

        'cache' => [
            'url' => env('REDIS_URL'),
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'username' => env('REDIS_USERNAME'),
            'password' => env('REDIS_PASSWORD'),
            'port' => env('REDIS_PORT', '6379'),
            'database' => env('REDIS_CACHE_DB', '1'),
        ],

    ],

];

```

# backend/config/filesystems.php

```php
<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => env('APP_URL').'/storage',
            'visibility' => 'public',
            'throw' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];

```

# backend/config/logging.php

```php
<?php

use Monolog\Handler\NullHandler;
use Monolog\Handler\StreamHandler;
use Monolog\Handler\SyslogUdpHandler;
use Monolog\Processor\PsrLogMessageProcessor;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Log Channel
    |--------------------------------------------------------------------------
    |
    | This option defines the default log channel that is utilized to write
    | messages to your logs. The value provided here should match one of
    | the channels present in the list of "channels" configured below.
    |
    */

    'default' => env('LOG_CHANNEL', 'stack'),

    /*
    |--------------------------------------------------------------------------
    | Deprecations Log Channel
    |--------------------------------------------------------------------------
    |
    | This option controls the log channel that should be used to log warnings
    | regarding deprecated PHP and library features. This allows you to get
    | your application ready for upcoming major versions of dependencies.
    |
    */

    'deprecations' => [
        'channel' => env('LOG_DEPRECATIONS_CHANNEL', 'null'),
        'trace' => env('LOG_DEPRECATIONS_TRACE', false),
    ],

    /*
    |--------------------------------------------------------------------------
    | Log Channels
    |--------------------------------------------------------------------------
    |
    | Here you may configure the log channels for your application. Laravel
    | utilizes the Monolog PHP logging library, which includes a variety
    | of powerful log handlers and formatters that you're free to use.
    |
    | Available drivers: "single", "daily", "slack", "syslog",
    |                    "errorlog", "monolog", "custom", "stack"
    |
    */

    'channels' => [

        'stack' => [
            'driver' => 'stack',
            'channels' => explode(',', env('LOG_STACK', 'single')),
            'ignore_exceptions' => false,
        ],

        'single' => [
            'driver' => 'single',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'replace_placeholders' => true,
        ],

        'daily' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.log'),
            'level' => env('LOG_LEVEL', 'debug'),
            'days' => env('LOG_DAILY_DAYS', 14),
            'replace_placeholders' => true,
        ],

        'slack' => [
            'driver' => 'slack',
            'url' => env('LOG_SLACK_WEBHOOK_URL'),
            'username' => env('LOG_SLACK_USERNAME', 'Laravel Log'),
            'emoji' => env('LOG_SLACK_EMOJI', ':boom:'),
            'level' => env('LOG_LEVEL', 'critical'),
            'replace_placeholders' => true,
        ],

        'papertrail' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'debug'),
            'handler' => env('LOG_PAPERTRAIL_HANDLER', SyslogUdpHandler::class),
            'handler_with' => [
                'host' => env('PAPERTRAIL_URL'),
                'port' => env('PAPERTRAIL_PORT'),
                'connectionString' => 'tls://'.env('PAPERTRAIL_URL').':'.env('PAPERTRAIL_PORT'),
            ],
            'processors' => [PsrLogMessageProcessor::class],
        ],

        'stderr' => [
            'driver' => 'monolog',
            'level' => env('LOG_LEVEL', 'debug'),
            'handler' => StreamHandler::class,
            'formatter' => env('LOG_STDERR_FORMATTER'),
            'with' => [
                'stream' => 'php://stderr',
            ],
            'processors' => [PsrLogMessageProcessor::class],
        ],

        'syslog' => [
            'driver' => 'syslog',
            'level' => env('LOG_LEVEL', 'debug'),
            'facility' => env('LOG_SYSLOG_FACILITY', LOG_USER),
            'replace_placeholders' => true,
        ],

        'errorlog' => [
            'driver' => 'errorlog',
            'level' => env('LOG_LEVEL', 'debug'),
            'replace_placeholders' => true,
        ],

        'null' => [
            'driver' => 'monolog',
            'handler' => NullHandler::class,
        ],

        'emergency' => [
            'path' => storage_path('logs/laravel.log'),
        ],

    ],

];

```

# backend/config/mail.php

```php
<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Mailer
    |--------------------------------------------------------------------------
    |
    | This option controls the default mailer that is used to send all email
    | messages unless another mailer is explicitly specified when sending
    | the message. All additional mailers can be configured within the
    | "mailers" array. Examples of each type of mailer are provided.
    |
    */

    'default' => env('MAIL_MAILER', 'log'),

    /*
    |--------------------------------------------------------------------------
    | Mailer Configurations
    |--------------------------------------------------------------------------
    |
    | Here you may configure all of the mailers used by your application plus
    | their respective settings. Several examples have been configured for
    | you and you are free to add your own as your application requires.
    |
    | Laravel supports a variety of mail "transport" drivers that can be used
    | when delivering an email. You may specify which one you're using for
    | your mailers below. You may also add additional mailers if needed.
    |
    | Supported: "smtp", "sendmail", "mailgun", "ses", "ses-v2",
    |            "postmark", "resend", "log", "array",
    |            "failover", "roundrobin"
    |
    */

    'mailers' => [

        'smtp' => [
            'transport' => 'smtp',
            'url' => env('MAIL_URL'),
            'host' => env('MAIL_HOST', '127.0.0.1'),
            'port' => env('MAIL_PORT', 2525),
            'encryption' => env('MAIL_ENCRYPTION', 'tls'),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            'timeout' => null,
            'local_domain' => env('MAIL_EHLO_DOMAIN', parse_url(env('APP_URL', 'http://localhost'), PHP_URL_HOST)),
        ],

        'ses' => [
            'transport' => 'ses',
        ],

        'postmark' => [
            'transport' => 'postmark',
            // 'message_stream_id' => env('POSTMARK_MESSAGE_STREAM_ID'),
            // 'client' => [
            //     'timeout' => 5,
            // ],
        ],

        'resend' => [
            'transport' => 'resend',
        ],

        'sendmail' => [
            'transport' => 'sendmail',
            'path' => env('MAIL_SENDMAIL_PATH', '/usr/sbin/sendmail -bs -i'),
        ],

        'log' => [
            'transport' => 'log',
            'channel' => env('MAIL_LOG_CHANNEL'),
        ],

        'array' => [
            'transport' => 'array',
        ],

        'failover' => [
            'transport' => 'failover',
            'mailers' => [
                'smtp',
                'log',
            ],
        ],

        'roundrobin' => [
            'transport' => 'roundrobin',
            'mailers' => [
                'ses',
                'postmark',
            ],
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Global "From" Address
    |--------------------------------------------------------------------------
    |
    | You may wish for all emails sent by your application to be sent from
    | the same address. Here you may specify a name and address that is
    | used globally for all emails that are sent by your application.
    |
    */

    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'hello@example.com'),
        'name' => env('MAIL_FROM_NAME', 'Example'),
    ],

];

```

# backend/config/queue.php

```php
<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Queue Connection Name
    |--------------------------------------------------------------------------
    |
    | Laravel's queue supports a variety of backends via a single, unified
    | API, giving you convenient access to each backend using identical
    | syntax for each. The default queue connection is defined below.
    |
    */

    'default' => env('QUEUE_CONNECTION', 'database'),

    /*
    |--------------------------------------------------------------------------
    | Queue Connections
    |--------------------------------------------------------------------------
    |
    | Here you may configure the connection options for every queue backend
    | used by your application. An example configuration is provided for
    | each backend supported by Laravel. You're also free to add more.
    |
    | Drivers: "sync", "database", "beanstalkd", "sqs", "redis", "null"
    |
    */

    'connections' => [

        'sync' => [
            'driver' => 'sync',
        ],

        'database' => [
            'driver' => 'database',
            'connection' => env('DB_QUEUE_CONNECTION'),
            'table' => env('DB_QUEUE_TABLE', 'jobs'),
            'queue' => env('DB_QUEUE', 'default'),
            'retry_after' => (int) env('DB_QUEUE_RETRY_AFTER', 90),
            'after_commit' => false,
        ],

        'beanstalkd' => [
            'driver' => 'beanstalkd',
            'host' => env('BEANSTALKD_QUEUE_HOST', 'localhost'),
            'queue' => env('BEANSTALKD_QUEUE', 'default'),
            'retry_after' => (int) env('BEANSTALKD_QUEUE_RETRY_AFTER', 90),
            'block_for' => 0,
            'after_commit' => false,
        ],

        'sqs' => [
            'driver' => 'sqs',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id'),
            'queue' => env('SQS_QUEUE', 'default'),
            'suffix' => env('SQS_SUFFIX'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'after_commit' => false,
        ],

        'redis' => [
            'driver' => 'redis',
            'connection' => env('REDIS_QUEUE_CONNECTION', 'default'),
            'queue' => env('REDIS_QUEUE', 'default'),
            'retry_after' => (int) env('REDIS_QUEUE_RETRY_AFTER', 90),
            'block_for' => null,
            'after_commit' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Job Batching
    |--------------------------------------------------------------------------
    |
    | The following options configure the database and table that store job
    | batching information. These options can be updated to any database
    | connection and table which has been defined by your application.
    |
    */

    'batching' => [
        'database' => env('DB_CONNECTION', 'sqlite'),
        'table' => 'job_batches',
    ],

    /*
    |--------------------------------------------------------------------------
    | Failed Queue Jobs
    |--------------------------------------------------------------------------
    |
    | These options configure the behavior of failed queue job logging so you
    | can control how and where failed jobs are stored. Laravel ships with
    | support for storing failed jobs in a simple file or in a database.
    |
    | Supported drivers: "database-uuids", "dynamodb", "file", "null"
    |
    */

    'failed' => [
        'driver' => env('QUEUE_FAILED_DRIVER', 'database-uuids'),
        'database' => env('DB_CONNECTION', 'sqlite'),
        'table' => 'failed_jobs',
    ],

];

```

# backend/config/sanctum.php

```php
<?php

use Laravel\Sanctum\Sanctum;

return [

    /*
    |--------------------------------------------------------------------------
    | Stateful Domains
    |--------------------------------------------------------------------------
    |
    | Requests from the following domains / hosts will receive stateful API
    | authentication cookies. Typically, these should include your local
    | and production domains which access your API via a frontend SPA.
    |
    */

    'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', sprintf(
        '%s%s',
        'localhost,localhost:3000,127.0.0.1,127.0.0.1:8000,::1',
        Sanctum::currentApplicationUrlWithPort()
    ))),

    /*
    |--------------------------------------------------------------------------
    | Sanctum Guards
    |--------------------------------------------------------------------------
    |
    | This array contains the authentication guards that will be checked when
    | Sanctum is trying to authenticate a request. If none of these guards
    | are able to authenticate the request, Sanctum will use the bearer
    | token that's present on an incoming request for authentication.
    |
    */

    'guard' => ['web'],

    /*
    |--------------------------------------------------------------------------
    | Expiration Minutes
    |--------------------------------------------------------------------------
    |
    | This value controls the number of minutes until an issued token will be
    | considered expired. This will override any values set in the token's
    | "expires_at" attribute, but first-party sessions are not affected.
    |
    */

    'expiration' => null,

    /*
    |--------------------------------------------------------------------------
    | Token Prefix
    |--------------------------------------------------------------------------
    |
    | Sanctum can prefix new tokens in order to take advantage of numerous
    | security scanning initiatives maintained by open source platforms
    | that notify developers if they commit tokens into repositories.
    |
    | See: https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning
    |
    */

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    /*
    |--------------------------------------------------------------------------
    | Sanctum Middleware
    |--------------------------------------------------------------------------
    |
    | When authenticating your first-party SPA with Sanctum you may need to
    | customize some of the middleware Sanctum uses while processing the
    | request. You may change the middleware listed below as required.
    |
    */

    'middleware' => [
        'authenticate_session' => Laravel\Sanctum\Http\Middleware\AuthenticateSession::class,
        'encrypt_cookies' => Illuminate\Cookie\Middleware\EncryptCookies::class,
        'validate_csrf_token' => Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class,
    ],

];

```

# backend/config/services.php

```php
<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'newsapi' => [
        'key' => env('NEWSAPI_KEY'),
        'base_url' => 'https://newsapi.org/v2/',
    ],

    'guardian' => [
        'key' => env('GUARDIAN_API_KEY'),
        'base_url' => 'https://content.guardianapis.com/',
    ],

    'nytimes' => [
        'key' => env('NYTIMES_API_KEY'),
        'base_url' => 'https://api.nytimes.com/svc/',
    ],
];

```

# backend/config/session.php

```php
<?php

use Illuminate\Support\Str;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Session Driver
    |--------------------------------------------------------------------------
    |
    | This option determines the default session driver that is utilized for
    | incoming requests. Laravel supports a variety of storage options to
    | persist session data. Database storage is a great default choice.
    |
    | Supported: "file", "cookie", "database", "apc",
    |            "memcached", "redis", "dynamodb", "array"
    |
    */

    'driver' => env('SESSION_DRIVER', 'database'),

    /*
    |--------------------------------------------------------------------------
    | Session Lifetime
    |--------------------------------------------------------------------------
    |
    | Here you may specify the number of minutes that you wish the session
    | to be allowed to remain idle before it expires. If you want them
    | to expire immediately when the browser is closed then you may
    | indicate that via the expire_on_close configuration option.
    |
    */

    'lifetime' => env('SESSION_LIFETIME', 120),

    'expire_on_close' => env('SESSION_EXPIRE_ON_CLOSE', false),

    /*
    |--------------------------------------------------------------------------
    | Session Encryption
    |--------------------------------------------------------------------------
    |
    | This option allows you to easily specify that all of your session data
    | should be encrypted before it's stored. All encryption is performed
    | automatically by Laravel and you may use the session like normal.
    |
    */

    'encrypt' => env('SESSION_ENCRYPT', false),

    /*
    |--------------------------------------------------------------------------
    | Session File Location
    |--------------------------------------------------------------------------
    |
    | When utilizing the "file" session driver, the session files are placed
    | on disk. The default storage location is defined here; however, you
    | are free to provide another location where they should be stored.
    |
    */

    'files' => storage_path('framework/sessions'),

    /*
    |--------------------------------------------------------------------------
    | Session Database Connection
    |--------------------------------------------------------------------------
    |
    | When using the "database" or "redis" session drivers, you may specify a
    | connection that should be used to manage these sessions. This should
    | correspond to a connection in your database configuration options.
    |
    */

    'connection' => env('SESSION_CONNECTION'),

    /*
    |--------------------------------------------------------------------------
    | Session Database Table
    |--------------------------------------------------------------------------
    |
    | When using the "database" session driver, you may specify the table to
    | be used to store sessions. Of course, a sensible default is defined
    | for you; however, you're welcome to change this to another table.
    |
    */

    'table' => env('SESSION_TABLE', 'sessions'),

    /*
    |--------------------------------------------------------------------------
    | Session Cache Store
    |--------------------------------------------------------------------------
    |
    | When using one of the framework's cache driven session backends, you may
    | define the cache store which should be used to store the session data
    | between requests. This must match one of your defined cache stores.
    |
    | Affects: "apc", "dynamodb", "memcached", "redis"
    |
    */

    'store' => env('SESSION_STORE'),

    /*
    |--------------------------------------------------------------------------
    | Session Sweeping Lottery
    |--------------------------------------------------------------------------
    |
    | Some session drivers must manually sweep their storage location to get
    | rid of old sessions from storage. Here are the chances that it will
    | happen on a given request. By default, the odds are 2 out of 100.
    |
    */

    'lottery' => [2, 100],

    /*
    |--------------------------------------------------------------------------
    | Session Cookie Name
    |--------------------------------------------------------------------------
    |
    | Here you may change the name of the session cookie that is created by
    | the framework. Typically, you should not need to change this value
    | since doing so does not grant a meaningful security improvement.
    |
    */

    'cookie' => env(
        'SESSION_COOKIE',
        Str::slug(env('APP_NAME', 'laravel'), '_').'_session'
    ),

    /*
    |--------------------------------------------------------------------------
    | Session Cookie Path
    |--------------------------------------------------------------------------
    |
    | The session cookie path determines the path for which the cookie will
    | be regarded as available. Typically, this will be the root path of
    | your application, but you're free to change this when necessary.
    |
    */

    'path' => env('SESSION_PATH', '/'),

    /*
    |--------------------------------------------------------------------------
    | Session Cookie Domain
    |--------------------------------------------------------------------------
    |
    | This value determines the domain and subdomains the session cookie is
    | available to. By default, the cookie will be available to the root
    | domain and all subdomains. Typically, this shouldn't be changed.
    |
    */

    'domain' => env('SESSION_DOMAIN'),

    /*
    |--------------------------------------------------------------------------
    | HTTPS Only Cookies
    |--------------------------------------------------------------------------
    |
    | By setting this option to true, session cookies will only be sent back
    | to the server if the browser has a HTTPS connection. This will keep
    | the cookie from being sent to you when it can't be done securely.
    |
    */

    'secure' => env('SESSION_SECURE_COOKIE'),

    /*
    |--------------------------------------------------------------------------
    | HTTP Access Only
    |--------------------------------------------------------------------------
    |
    | Setting this value to true will prevent JavaScript from accessing the
    | value of the cookie and the cookie will only be accessible through
    | the HTTP protocol. It's unlikely you should disable this option.
    |
    */

    'http_only' => env('SESSION_HTTP_ONLY', true),

    /*
    |--------------------------------------------------------------------------
    | Same-Site Cookies
    |--------------------------------------------------------------------------
    |
    | This option determines how your cookies behave when cross-site requests
    | take place, and can be used to mitigate CSRF attacks. By default, we
    | will set this value to "lax" to permit secure cross-site requests.
    |
    | See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#samesitesamesite-value
    |
    | Supported: "lax", "strict", "none", null
    |
    */

    'same_site' => env('SESSION_SAME_SITE', 'lax'),

    /*
    |--------------------------------------------------------------------------
    | Partitioned Cookies
    |--------------------------------------------------------------------------
    |
    | Setting this value to true will tie the cookie to the top-level site for
    | a cross-site context. Partitioned cookies are accepted by the browser
    | when flagged "secure" and the Same-Site attribute is set to "none".
    |
    */

    'partitioned' => env('SESSION_PARTITIONED_COOKIE', false),

];

```

# backend/database/.gitignore

```
*.sqlite*

```

# backend/database/database.sqlite

This is a binary file of the type: Binary

# backend/database/factories/ArticleFactory.php

```php
<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Article>
 */
class ArticleFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            //
        ];
    }
}

```

# backend/database/factories/CategoryFactory.php

```php
<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Category>
 */
class CategoryFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            //
        ];
    }
}

```

# backend/database/factories/SourceFactory.php

```php
<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Source>
 */
class SourceFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            //
        ];
    }
}

```

# backend/database/factories/UserFactory.php

```php
<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'remember_token' => Str::random(10),
        ];
    }

    /**
     * Indicate that the model's email address should be unverified.
     */
    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }
}

```

# backend/database/migrations/0001_01_01_000000_create_users_table.php

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('sessions');
    }
};

```

# backend/database/migrations/0001_01_01_000001_create_cache_table.php

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('cache', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->mediumText('value');
            $table->integer('expiration');
        });

        Schema::create('cache_locks', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->string('owner');
            $table->integer('expiration');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('cache');
        Schema::dropIfExists('cache_locks');
    }
};

```

# backend/database/migrations/0001_01_01_000002_create_jobs_table.php

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('jobs', function (Blueprint $table) {
            $table->id();
            $table->string('queue')->index();
            $table->longText('payload');
            $table->unsignedTinyInteger('attempts');
            $table->unsignedInteger('reserved_at')->nullable();
            $table->unsignedInteger('available_at');
            $table->unsignedInteger('created_at');
        });

        Schema::create('job_batches', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('name');
            $table->integer('total_jobs');
            $table->integer('pending_jobs');
            $table->integer('failed_jobs');
            $table->longText('failed_job_ids');
            $table->mediumText('options')->nullable();
            $table->integer('cancelled_at')->nullable();
            $table->integer('created_at');
            $table->integer('finished_at')->nullable();
        });

        Schema::create('failed_jobs', function (Blueprint $table) {
            $table->id();
            $table->string('uuid')->unique();
            $table->text('connection');
            $table->text('queue');
            $table->longText('payload');
            $table->longText('exception');
            $table->timestamp('failed_at')->useCurrent();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('jobs');
        Schema::dropIfExists('job_batches');
        Schema::dropIfExists('failed_jobs');
    }
};

```

# backend/database/migrations/2024_11_26_184203_create_categories_table.php

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('categories');
    }
};

```

# backend/database/migrations/2024_11_26_184209_create_sources_table.php

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('sources', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('api_id')->nullable();
            $table->string('url')->nullable();
            $table->string('api_source'); // newsapi, guardian, nytimes
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sources');
    }
};

```

# backend/database/migrations/2024_11_26_184212_create_articles_table.php

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('articles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('source_id')->constrained()->onDelete('cascade');
            $table->string('title');
            $table->text('description')->nullable();
            $table->text('content')->nullable();
            $table->string('author')->nullable();
            $table->string('url');
            $table->string('image_url')->nullable();
            $table->timestamp('published_at');
            $table->string('api_source');
            $table->string('api_id')->unique();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('articles');
    }
};

```

# backend/database/migrations/2024_11_26_184215_create_article_category_table.php

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('article_category', function (Blueprint $table) {
            $table->id();
            $table->foreignId('article_id')->constrained()->onDelete('cascade');
            $table->foreignId('category_id')->constrained()->onDelete('cascade');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('article_category');
    }
};

```

# backend/database/migrations/2024_11_26_184217_create_user_preferences_table.php

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::dropIfExists('user_preferences');

        Schema::create('user_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->json('preferred_categories')->nullable();
            $table->json('preferred_sources')->nullable();
            $table->json('preferred_authors')->nullable();
            $table->boolean('email_notifications')->default(false);
            $table->enum('update_frequency', ['daily', 'weekly', 'never'])->default('daily');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_preferences');
    }
};

```

# backend/database/seeders/DatabaseSeeder.php

```php
<?php

namespace Database\Seeders;

use App\Models\User;
// use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // User::factory(10)->create();

        User::factory()->create([
            'name' => 'Test User',
            'email' => 'test@example.com',
        ]);
    }
}

```

# backend/database/seeders/TestDataSeeder.php

```php
<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Source;
use App\Models\Article;
use Illuminate\Database\Seeder;

class TestDataSeeder extends Seeder
{
    public function run(): void
    {
        // Create categories
        $categories = [
            ['name' => 'Technology', 'slug' => 'technology'],
            ['name' => 'Business', 'slug' => 'business'],
            ['name' => 'Science', 'slug' => 'science'],
            ['name' => 'Health', 'slug' => 'health'],
            ['name' => 'Sports', 'slug' => 'sports'],
        ];

        foreach ($categories as $category) {
            Category::create($category);
        }

        // Create sources
        $sources = [
            [
                'name' => 'Test Source 1',
                'slug' => 'test-source-1',
                'api_source' => 'newsapi',
                'api_id' => 'test-1'
            ],
            [
                'name' => 'Test Source 2',
                'slug' => 'test-source-2',
                'api_source' => 'guardian',
                'api_id' => 'test-2'
            ],
            [
                'name' => 'Test Source 3',
                'slug' => 'test-source-3',
                'api_source' => 'nytimes',
                'api_id' => 'test-3'
            ]
        ];

        foreach ($sources as $source) {
            Source::create($source);
        }

        // Create articles
        foreach (Source::all() as $source) {
            for ($i = 1; $i <= 5; $i++) {
                $article = Article::create([
                    'source_id' => $source->id,
                    'title' => "Test Article {$i} from {$source->name}",
                    'description' => 'This is a test description for the article.',
                    'content' => 'This is the main content of the test article. It contains more detailed information.',
                    'author' => 'Test Author',
                    'url' => "https://example.com/article-{$i}",
                    'image_url' => "https://example.com/images/article-{$i}.jpg",
                    'published_at' => now()->subHours($i),
                    'api_source' => $source->api_source,
                    'api_id' => "test-article-{$source->id}-{$i}"
                ]);

                // Attach random categories to each article
                $randomCategories = Category::inRandomOrder()->limit(2)->get();
                $article->categories()->attach($randomCategories->pluck('id'));
            }
        }
    }
}

```

# backend/Dockerfile

```
FROM php:8.2-fpm

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libpng-dev \
    libonig-dev \
    libxml2-dev \
    zip \
    unzip \
    libpq-dev

# Clear cache
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Install PHP extensions
RUN docker-php-ext-install pdo_pgsql pgsql mbstring exif pcntl bcmath gd

# Get latest Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Set working directory
WORKDIR /var/www/html

# Copy existing application directory
COPY . .

# Install dependencies
RUN composer install

# Change ownership of our applications
RUN chown -R www-data:www-data /var/www/html

EXPOSE 9000
CMD ["php-fpm"]

```

# backend/package.json

```json
{
    "private": true,
    "type": "module",
    "scripts": {
        "build": "vite build",
        "dev": "vite"
    },
    "devDependencies": {
        "autoprefixer": "^10.4.20",
        "axios": "^1.7.4",
        "concurrently": "^9.0.1",
        "laravel-vite-plugin": "^1.0",
        "postcss": "^8.4.47",
        "tailwindcss": "^3.4.13",
        "vite": "^5.0"
    }
}

```

# backend/phpunit.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
>
    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>app</directory>
        </include>
    </source>
    <php>
        <env name="APP_ENV" value="testing"/>
        <env name="APP_MAINTENANCE_DRIVER" value="file"/>
        <env name="BCRYPT_ROUNDS" value="4"/>
        <env name="CACHE_STORE" value="array"/>
        <!-- <env name="DB_CONNECTION" value="sqlite"/> -->
        <!-- <env name="DB_DATABASE" value=":memory:"/> -->
        <env name="MAIL_MAILER" value="array"/>
        <env name="PULSE_ENABLED" value="false"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="SESSION_DRIVER" value="array"/>
        <env name="TELESCOPE_ENABLED" value="false"/>
    </php>
</phpunit>

```

# backend/postcss.config.js

```js
export default {
    plugins: {
        tailwindcss: {},
        autoprefixer: {},
    },
};

```

# backend/public/.htaccess

```
<IfModule mod_rewrite.c>
    <IfModule mod_negotiation.c>
        Options -MultiViews -Indexes
    </IfModule>

    RewriteEngine On

    # Handle Authorization Header
    RewriteCond %{HTTP:Authorization} .
    RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]

    # Redirect Trailing Slashes If Not A Folder...
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteCond %{REQUEST_URI} (.+)/$
    RewriteRule ^ %1 [L,R=301]

    # Send Requests To Front Controller...
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteRule ^ index.php [L]
</IfModule>

```

# backend/public/favicon.ico

```ico

```

# backend/public/index.php

```php
<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
(require_once __DIR__.'/../bootstrap/app.php')
    ->handleRequest(Request::capture());

```

# backend/public/robots.txt

```txt
User-agent: *
Disallow:

```

# backend/README.md

```md
<p align="center"><a href="https://laravel.com" target="_blank"><img src="https://raw.githubusercontent.com/laravel/art/master/logo-lockup/5%20SVG/2%20CMYK/1%20Full%20Color/laravel-logolockup-cmyk-red.svg" width="400" alt="Laravel Logo"></a></p>

<p align="center">
<a href="https://github.com/laravel/framework/actions"><img src="https://github.com/laravel/framework/workflows/tests/badge.svg" alt="Build Status"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/dt/laravel/framework" alt="Total Downloads"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/v/laravel/framework" alt="Latest Stable Version"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/l/laravel/framework" alt="License"></a>
</p>

## About Laravel

Laravel is a web application framework with expressive, elegant syntax. We believe development must be an enjoyable and creative experience to be truly fulfilling. Laravel takes the pain out of development by easing common tasks used in many web projects, such as:

- [Simple, fast routing engine](https://laravel.com/docs/routing).
- [Powerful dependency injection container](https://laravel.com/docs/container).
- Multiple back-ends for [session](https://laravel.com/docs/session) and [cache](https://laravel.com/docs/cache) storage.
- Expressive, intuitive [database ORM](https://laravel.com/docs/eloquent).
- Database agnostic [schema migrations](https://laravel.com/docs/migrations).
- [Robust background job processing](https://laravel.com/docs/queues).
- [Real-time event broadcasting](https://laravel.com/docs/broadcasting).

Laravel is accessible, powerful, and provides tools required for large, robust applications.

## Learning Laravel

Laravel has the most extensive and thorough [documentation](https://laravel.com/docs) and video tutorial library of all modern web application frameworks, making it a breeze to get started with the framework.

You may also try the [Laravel Bootcamp](https://bootcamp.laravel.com), where you will be guided through building a modern Laravel application from scratch.

If you don't feel like reading, [Laracasts](https://laracasts.com) can help. Laracasts contains thousands of video tutorials on a range of topics including Laravel, modern PHP, unit testing, and JavaScript. Boost your skills by digging into our comprehensive video library.

## Laravel Sponsors

We would like to extend our thanks to the following sponsors for funding Laravel development. If you are interested in becoming a sponsor, please visit the [Laravel Partners program](https://partners.laravel.com).

### Premium Partners

- **[Vehikl](https://vehikl.com/)**
- **[Tighten Co.](https://tighten.co)**
- **[WebReinvent](https://webreinvent.com/)**
- **[Kirschbaum Development Group](https://kirschbaumdevelopment.com)**
- **[64 Robots](https://64robots.com)**
- **[Curotec](https://www.curotec.com/services/technologies/laravel/)**
- **[Cyber-Duck](https://cyber-duck.co.uk)**
- **[DevSquad](https://devsquad.com/hire-laravel-developers)**
- **[Jump24](https://jump24.co.uk)**
- **[Redberry](https://redberry.international/laravel/)**
- **[Active Logic](https://activelogic.com)**
- **[byte5](https://byte5.de)**
- **[OP.GG](https://op.gg)**

## Contributing

Thank you for considering contributing to the Laravel framework! The contribution guide can be found in the [Laravel documentation](https://laravel.com/docs/contributions).

## Code of Conduct

In order to ensure that the Laravel community is welcoming to all, please review and abide by the [Code of Conduct](https://laravel.com/docs/contributions#code-of-conduct).

## Security Vulnerabilities

If you discover a security vulnerability within Laravel, please send an e-mail to Taylor Otwell via [taylor@laravel.com](mailto:taylor@laravel.com). All security vulnerabilities will be promptly addressed.

## License

The Laravel framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).

```

# backend/resources/css/app.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

```

# backend/resources/js/app.js

```js
import './bootstrap';

```

# backend/resources/js/bootstrap.js

```js
import axios from 'axios';
window.axios = axios;

window.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

```

# backend/resources/views/welcome.blade.php

```php
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">

        <title>Laravel</title>

        <!-- Fonts -->
        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

        <!-- Styles / Scripts -->
        @if (file_exists(public_path('build/manifest.json')) || file_exists(public_path('hot')))
            @vite(['resources/css/app.css', 'resources/js/app.js'])
        @else
            <style>
                /* ! tailwindcss v3.4.1 | MIT License | https://tailwindcss.com */*,::after,::before{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb}::after,::before{--tw-content:''}:host,html{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;tab-size:4;font-family:Figtree, ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji;font-feature-settings:normal;font-variation-settings:normal;-webkit-tap-highlight-color:transparent}body{margin:0;line-height:inherit}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,pre,samp{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;font-feature-settings:normal;font-variation-settings:normal;font-size:1em}small{font-size:80%}sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}button,input,optgroup,select,textarea{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;color:inherit;margin:0;padding:0}button,select{text-transform:none}[type=button],[type=reset],[type=submit],button{-webkit-appearance:button;background-color:transparent;background-image:none}:-moz-focusring{outline:auto}:-moz-ui-invalid{box-shadow:none}progress{vertical-align:baseline}::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}[type=search]{-webkit-appearance:textfield;outline-offset:-2px}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}summary{display:list-item}blockquote,dd,dl,figure,h1,h2,h3,h4,h5,h6,hr,p,pre{margin:0}fieldset{margin:0;padding:0}legend{padding:0}menu,ol,ul{list-style:none;margin:0;padding:0}dialog{padding:0}textarea{resize:vertical}input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}[role=button],button{cursor:pointer}:disabled{cursor:default}audio,canvas,embed,iframe,img,object,svg,video{display:block;vertical-align:middle}img,video{max-width:100%;height:auto}[hidden]{display:none}*, ::before, ::after{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgb(59 130 246 / 0.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: }::backdrop{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgb(59 130 246 / 0.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: }.absolute{position:absolute}.relative{position:relative}.-left-20{left:-5rem}.top-0{top:0px}.-bottom-16{bottom:-4rem}.-left-16{left:-4rem}.-mx-3{margin-left:-0.75rem;margin-right:-0.75rem}.mt-4{margin-top:1rem}.mt-6{margin-top:1.5rem}.flex{display:flex}.grid{display:grid}.hidden{display:none}.aspect-video{aspect-ratio:16 / 9}.size-12{width:3rem;height:3rem}.size-5{width:1.25rem;height:1.25rem}.size-6{width:1.5rem;height:1.5rem}.h-12{height:3rem}.h-40{height:10rem}.h-full{height:100%}.min-h-screen{min-height:100vh}.w-full{width:100%}.w-\[calc\(100\%\+8rem\)\]{width:calc(100% + 8rem)}.w-auto{width:auto}.max-w-\[877px\]{max-width:877px}.max-w-2xl{max-width:42rem}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.grid-cols-2{grid-template-columns:repeat(2, minmax(0, 1fr))}.flex-col{flex-direction:column}.items-start{align-items:flex-start}.items-center{align-items:center}.items-stretch{align-items:stretch}.justify-end{justify-content:flex-end}.justify-center{justify-content:center}.gap-2{gap:0.5rem}.gap-4{gap:1rem}.gap-6{gap:1.5rem}.self-center{align-self:center}.overflow-hidden{overflow:hidden}.rounded-\[10px\]{border-radius:10px}.rounded-full{border-radius:9999px}.rounded-lg{border-radius:0.5rem}.rounded-md{border-radius:0.375rem}.rounded-sm{border-radius:0.125rem}.bg-\[\#FF2D20\]\/10{background-color:rgb(255 45 32 / 0.1)}.bg-white{--tw-bg-opacity:1;background-color:rgb(255 255 255 / var(--tw-bg-opacity))}.bg-gradient-to-b{background-image:linear-gradient(to bottom, var(--tw-gradient-stops))}.from-transparent{--tw-gradient-from:transparent var(--tw-gradient-from-position);--tw-gradient-to:rgb(0 0 0 / 0) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), var(--tw-gradient-to)}.via-white{--tw-gradient-to:rgb(255 255 255 / 0)  var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), #fff var(--tw-gradient-via-position), var(--tw-gradient-to)}.to-white{--tw-gradient-to:#fff var(--tw-gradient-to-position)}.stroke-\[\#FF2D20\]{stroke:#FF2D20}.object-cover{object-fit:cover}.object-top{object-position:top}.p-6{padding:1.5rem}.px-6{padding-left:1.5rem;padding-right:1.5rem}.py-10{padding-top:2.5rem;padding-bottom:2.5rem}.px-3{padding-left:0.75rem;padding-right:0.75rem}.py-16{padding-top:4rem;padding-bottom:4rem}.py-2{padding-top:0.5rem;padding-bottom:0.5rem}.pt-3{padding-top:0.75rem}.text-center{text-align:center}.font-sans{font-family:Figtree, ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji}.text-sm{font-size:0.875rem;line-height:1.25rem}.text-sm\/relaxed{font-size:0.875rem;line-height:1.625}.text-xl{font-size:1.25rem;line-height:1.75rem}.font-semibold{font-weight:600}.text-black{--tw-text-opacity:1;color:rgb(0 0 0 / var(--tw-text-opacity))}.text-white{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity))}.underline{-webkit-text-decoration-line:underline;text-decoration-line:underline}.antialiased{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}.shadow-\[0px_14px_34px_0px_rgba\(0\2c 0\2c 0\2c 0\.08\)\]{--tw-shadow:0px 14px 34px 0px rgba(0,0,0,0.08);--tw-shadow-colored:0px 14px 34px 0px var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)}.ring-1{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000)}.ring-transparent{--tw-ring-color:transparent}.ring-white\/\[0\.05\]{--tw-ring-color:rgb(255 255 255 / 0.05)}.drop-shadow-\[0px_4px_34px_rgba\(0\2c 0\2c 0\2c 0\.06\)\]{--tw-drop-shadow:drop-shadow(0px 4px 34px rgba(0,0,0,0.06));filter:var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow)}.drop-shadow-\[0px_4px_34px_rgba\(0\2c 0\2c 0\2c 0\.25\)\]{--tw-drop-shadow:drop-shadow(0px 4px 34px rgba(0,0,0,0.25));filter:var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow)}.transition{transition-property:color, background-color, border-color, fill, stroke, opacity, box-shadow, transform, filter, -webkit-text-decoration-color, -webkit-backdrop-filter;transition-property:color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;transition-property:color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter, -webkit-text-decoration-color, -webkit-backdrop-filter;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);transition-duration:150ms}.duration-300{transition-duration:300ms}.selection\:bg-\[\#FF2D20\] *::selection{--tw-bg-opacity:1;background-color:rgb(255 45 32 / var(--tw-bg-opacity))}.selection\:text-white *::selection{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity))}.selection\:bg-\[\#FF2D20\]::selection{--tw-bg-opacity:1;background-color:rgb(255 45 32 / var(--tw-bg-opacity))}.selection\:text-white::selection{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity))}.hover\:text-black:hover{--tw-text-opacity:1;color:rgb(0 0 0 / var(--tw-text-opacity))}.hover\:text-black\/70:hover{color:rgb(0 0 0 / 0.7)}.hover\:ring-black\/20:hover{--tw-ring-color:rgb(0 0 0 / 0.2)}.focus\:outline-none:focus{outline:2px solid transparent;outline-offset:2px}.focus-visible\:ring-1:focus-visible{--tw-ring-offset-shadow:var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);--tw-ring-shadow:var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color);box-shadow:var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000)}.focus-visible\:ring-\[\#FF2D20\]:focus-visible{--tw-ring-opacity:1;--tw-ring-color:rgb(255 45 32 / var(--tw-ring-opacity))}@media (min-width: 640px){.sm\:size-16{width:4rem;height:4rem}.sm\:size-6{width:1.5rem;height:1.5rem}.sm\:pt-5{padding-top:1.25rem}}@media (min-width: 768px){.md\:row-span-3{grid-row:span 3 / span 3}}@media (min-width: 1024px){.lg\:col-start-2{grid-column-start:2}.lg\:h-16{height:4rem}.lg\:max-w-7xl{max-width:80rem}.lg\:grid-cols-3{grid-template-columns:repeat(3, minmax(0, 1fr))}.lg\:grid-cols-2{grid-template-columns:repeat(2, minmax(0, 1fr))}.lg\:flex-col{flex-direction:column}.lg\:items-end{align-items:flex-end}.lg\:justify-center{justify-content:center}.lg\:gap-8{gap:2rem}.lg\:p-10{padding:2.5rem}.lg\:pb-10{padding-bottom:2.5rem}.lg\:pt-0{padding-top:0px}.lg\:text-\[\#FF2D20\]{--tw-text-opacity:1;color:rgb(255 45 32 / var(--tw-text-opacity))}}@media (prefers-color-scheme: dark){.dark\:block{display:block}.dark\:hidden{display:none}.dark\:bg-black{--tw-bg-opacity:1;background-color:rgb(0 0 0 / var(--tw-bg-opacity))}.dark\:bg-zinc-900{--tw-bg-opacity:1;background-color:rgb(24 24 27 / var(--tw-bg-opacity))}.dark\:via-zinc-900{--tw-gradient-to:rgb(24 24 27 / 0)  var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), #18181b var(--tw-gradient-via-position), var(--tw-gradient-to)}.dark\:to-zinc-900{--tw-gradient-to:#18181b var(--tw-gradient-to-position)}.dark\:text-white\/50{color:rgb(255 255 255 / 0.5)}.dark\:text-white{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity))}.dark\:text-white\/70{color:rgb(255 255 255 / 0.7)}.dark\:ring-zinc-800{--tw-ring-opacity:1;--tw-ring-color:rgb(39 39 42 / var(--tw-ring-opacity))}.dark\:hover\:text-white:hover{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity))}.dark\:hover\:text-white\/70:hover{color:rgb(255 255 255 / 0.7)}.dark\:hover\:text-white\/80:hover{color:rgb(255 255 255 / 0.8)}.dark\:hover\:ring-zinc-700:hover{--tw-ring-opacity:1;--tw-ring-color:rgb(63 63 70 / var(--tw-ring-opacity))}.dark\:focus-visible\:ring-\[\#FF2D20\]:focus-visible{--tw-ring-opacity:1;--tw-ring-color:rgb(255 45 32 / var(--tw-ring-opacity))}.dark\:focus-visible\:ring-white:focus-visible{--tw-ring-opacity:1;--tw-ring-color:rgb(255 255 255 / var(--tw-ring-opacity))}}
            </style>
        @endif
    </head>
    <body class="font-sans antialiased dark:bg-black dark:text-white/50">
        <div class="bg-gray-50 text-black/50 dark:bg-black dark:text-white/50">
            <img id="background" class="absolute -left-20 top-0 max-w-[877px]" src="https://laravel.com/assets/img/welcome/background.svg" alt="Laravel background" />
            <div class="relative min-h-screen flex flex-col items-center justify-center selection:bg-[#FF2D20] selection:text-white">
                <div class="relative w-full max-w-2xl px-6 lg:max-w-7xl">
                    <header class="grid grid-cols-2 items-center gap-2 py-10 lg:grid-cols-3">
                        <div class="flex lg:justify-center lg:col-start-2">
                            <svg class="h-12 w-auto text-white lg:h-16 lg:text-[#FF2D20]" viewBox="0 0 62 65" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M61.8548 14.6253C61.8778 14.7102 61.8895 14.7978 61.8897 14.8858V28.5615C61.8898 28.737 61.8434 28.9095 61.7554 29.0614C61.6675 29.2132 61.5409 29.3392 61.3887 29.4265L49.9104 36.0351V49.1337C49.9104 49.4902 49.7209 49.8192 49.4118 49.9987L25.4519 63.7916C25.3971 63.8227 25.3372 63.8427 25.2774 63.8639C25.255 63.8714 25.2338 63.8851 25.2101 63.8913C25.0426 63.9354 24.8666 63.9354 24.6991 63.8913C24.6716 63.8838 24.6467 63.8689 24.6205 63.8589C24.5657 63.8389 24.5084 63.8215 24.456 63.7916L0.501061 49.9987C0.348882 49.9113 0.222437 49.7853 0.134469 49.6334C0.0465019 49.4816 0.000120578 49.3092 0 49.1337L0 8.10652C0 8.01678 0.0124642 7.92953 0.0348998 7.84477C0.0423783 7.8161 0.0598282 7.78993 0.0697995 7.76126C0.0884958 7.70891 0.105946 7.65531 0.133367 7.6067C0.152063 7.5743 0.179485 7.54812 0.20192 7.51821C0.230588 7.47832 0.256763 7.43719 0.290416 7.40229C0.319084 7.37362 0.356476 7.35243 0.388883 7.32751C0.425029 7.29759 0.457436 7.26518 0.498568 7.2415L12.4779 0.345059C12.6296 0.257786 12.8015 0.211853 12.9765 0.211853C13.1515 0.211853 13.3234 0.257786 13.475 0.345059L25.4531 7.2415H25.4556C25.4955 7.26643 25.5292 7.29759 25.5653 7.32626C25.5977 7.35119 25.6339 7.37362 25.6625 7.40104C25.6974 7.43719 25.7224 7.47832 25.7523 7.51821C25.7735 7.54812 25.8021 7.5743 25.8196 7.6067C25.8483 7.65656 25.8645 7.70891 25.8844 7.76126C25.8944 7.78993 25.9118 7.8161 25.9193 7.84602C25.9423 7.93096 25.954 8.01853 25.9542 8.10652V33.7317L35.9355 27.9844V14.8846C35.9355 14.7973 35.948 14.7088 35.9704 14.6253C35.9792 14.5954 35.9954 14.5692 36.0053 14.5405C36.0253 14.4882 36.0427 14.4346 36.0702 14.386C36.0888 14.3536 36.1163 14.3274 36.1375 14.2975C36.1674 14.2576 36.1923 14.2165 36.2272 14.1816C36.2559 14.1529 36.292 14.1317 36.3244 14.1068C36.3618 14.0769 36.3942 14.0445 36.4341 14.0208L48.4147 7.12434C48.5663 7.03694 48.7383 6.99094 48.9133 6.99094C49.0883 6.99094 49.2602 7.03694 49.4118 7.12434L61.3899 14.0208C61.4323 14.0457 61.4647 14.0769 61.5021 14.1055C61.5333 14.1305 61.5694 14.1529 61.5981 14.1803C61.633 14.2165 61.6579 14.2576 61.6878 14.2975C61.7103 14.3274 61.7377 14.3536 61.7551 14.386C61.7838 14.4346 61.8 14.4882 61.8199 14.5405C61.8312 14.5692 61.8474 14.5954 61.8548 14.6253ZM59.893 27.9844V16.6121L55.7013 19.0252L49.9104 22.3593V33.7317L59.8942 27.9844H59.893ZM47.9149 48.5566V37.1768L42.2187 40.4299L25.953 49.7133V61.2003L47.9149 48.5566ZM1.99677 9.83281V48.5566L23.9562 61.199V49.7145L12.4841 43.2219L12.4804 43.2194L12.4754 43.2169C12.4368 43.1945 12.4044 43.1621 12.3682 43.1347C12.3371 43.1097 12.3009 43.0898 12.2735 43.0624L12.271 43.0586C12.2386 43.0275 12.2162 42.9888 12.1887 42.9539C12.1638 42.9203 12.1339 42.8916 12.114 42.8567L12.1127 42.853C12.0903 42.8156 12.0766 42.7707 12.0604 42.7283C12.0442 42.6909 12.023 42.656 12.013 42.6161C12.0005 42.5688 11.998 42.5177 11.9931 42.4691C11.9881 42.4317 11.9781 42.3943 11.9781 42.3569V15.5801L6.18848 12.2446L1.99677 9.83281ZM12.9777 2.36177L2.99764 8.10652L12.9752 13.8513L22.9541 8.10527L12.9752 2.36177H12.9777ZM18.1678 38.2138L23.9574 34.8809V9.83281L19.7657 12.2459L13.9749 15.5801V40.6281L18.1678 38.2138ZM48.9133 9.14105L38.9344 14.8858L48.9133 20.6305L58.8909 14.8846L48.9133 9.14105ZM47.9149 22.3593L42.124 19.0252L37.9323 16.6121V27.9844L43.7219 31.3174L47.9149 33.7317V22.3593ZM24.9533 47.987L39.59 39.631L46.9065 35.4555L36.9352 29.7145L25.4544 36.3242L14.9907 42.3482L24.9533 47.987Z" fill="currentColor"/></svg>
                        </div>
                        @if (Route::has('login'))
                            <nav class="-mx-3 flex flex-1 justify-end">
                                @auth
                                    <a
                                        href="{{ url('/dashboard') }}"
                                        class="rounded-md px-3 py-2 text-black ring-1 ring-transparent transition hover:text-black/70 focus:outline-none focus-visible:ring-[#FF2D20] dark:text-white dark:hover:text-white/80 dark:focus-visible:ring-white"
                                    >
                                        Dashboard
                                    </a>
                                @else
                                    <a
                                        href="{{ route('login') }}"
                                        class="rounded-md px-3 py-2 text-black ring-1 ring-transparent transition hover:text-black/70 focus:outline-none focus-visible:ring-[#FF2D20] dark:text-white dark:hover:text-white/80 dark:focus-visible:ring-white"
                                    >
                                        Log in
                                    </a>

                                    @if (Route::has('register'))
                                        <a
                                            href="{{ route('register') }}"
                                            class="rounded-md px-3 py-2 text-black ring-1 ring-transparent transition hover:text-black/70 focus:outline-none focus-visible:ring-[#FF2D20] dark:text-white dark:hover:text-white/80 dark:focus-visible:ring-white"
                                        >
                                            Register
                                        </a>
                                    @endif
                                @endauth
                            </nav>
                        @endif
                    </header>

                    <main class="mt-6">
                        <div class="grid gap-6 lg:grid-cols-2 lg:gap-8">
                            <a
                                href="https://laravel.com/docs"
                                id="docs-card"
                                class="flex flex-col items-start gap-6 overflow-hidden rounded-lg bg-white p-6 shadow-[0px_14px_34px_0px_rgba(0,0,0,0.08)] ring-1 ring-white/[0.05] transition duration-300 hover:text-black/70 hover:ring-black/20 focus:outline-none focus-visible:ring-[#FF2D20] md:row-span-3 lg:p-10 lg:pb-10 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:text-white/70 dark:hover:ring-zinc-700 dark:focus-visible:ring-[#FF2D20]"
                            >
                                <div id="screenshot-container" class="relative flex w-full flex-1 items-stretch">
                                    <img
                                        src="https://laravel.com/assets/img/welcome/docs-light.svg"
                                        alt="Laravel documentation screenshot"
                                        class="aspect-video h-full w-full flex-1 rounded-[10px] object-top object-cover drop-shadow-[0px_4px_34px_rgba(0,0,0,0.06)] dark:hidden"
                                        onerror="
                                            document.getElementById('screenshot-container').classList.add('!hidden');
                                            document.getElementById('docs-card').classList.add('!row-span-1');
                                            document.getElementById('docs-card-content').classList.add('!flex-row');
                                            document.getElementById('background').classList.add('!hidden');
                                        "
                                    />
                                    <img
                                        src="https://laravel.com/assets/img/welcome/docs-dark.svg"
                                        alt="Laravel documentation screenshot"
                                        class="hidden aspect-video h-full w-full flex-1 rounded-[10px] object-top object-cover drop-shadow-[0px_4px_34px_rgba(0,0,0,0.25)] dark:block"
                                    />
                                    <div
                                        class="absolute -bottom-16 -left-16 h-40 w-[calc(100%+8rem)] bg-gradient-to-b from-transparent via-white to-white dark:via-zinc-900 dark:to-zinc-900"
                                    ></div>
                                </div>

                                <div class="relative flex items-center gap-6 lg:items-end">
                                    <div id="docs-card-content" class="flex items-start gap-6 lg:flex-col">
                                        <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#FF2D20]/10 sm:size-16">
                                            <svg class="size-5 sm:size-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path fill="#FF2D20" d="M23 4a1 1 0 0 0-1.447-.894L12.224 7.77a.5.5 0 0 1-.448 0L2.447 3.106A1 1 0 0 0 1 4v13.382a1.99 1.99 0 0 0 1.105 1.79l9.448 4.728c.14.065.293.1.447.1.154-.005.306-.04.447-.105l9.453-4.724a1.99 1.99 0 0 0 1.1-1.789V4ZM3 6.023a.25.25 0 0 1 .362-.223l7.5 3.75a.251.251 0 0 1 .138.223v11.2a.25.25 0 0 1-.362.224l-7.5-3.75a.25.25 0 0 1-.138-.22V6.023Zm18 11.2a.25.25 0 0 1-.138.224l-7.5 3.75a.249.249 0 0 1-.329-.099.249.249 0 0 1-.033-.12V9.772a.251.251 0 0 1 .138-.224l7.5-3.75a.25.25 0 0 1 .362.224v11.2Z"/><path fill="#FF2D20" d="m3.55 1.893 8 4.048a1.008 1.008 0 0 0 .9 0l8-4.048a1 1 0 0 0-.9-1.785l-7.322 3.706a.506.506 0 0 1-.452 0L4.454.108a1 1 0 0 0-.9 1.785H3.55Z"/></svg>
                                        </div>

                                        <div class="pt-3 sm:pt-5 lg:pt-0">
                                            <h2 class="text-xl font-semibold text-black dark:text-white">Documentation</h2>

                                            <p class="mt-4 text-sm/relaxed">
                                                Laravel has wonderful documentation covering every aspect of the framework. Whether you are a newcomer or have prior experience with Laravel, we recommend reading our documentation from beginning to end.
                                            </p>
                                        </div>
                                    </div>

                                    <svg class="size-6 shrink-0 stroke-[#FF2D20]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75"/></svg>
                                </div>
                            </a>

                            <a
                                href="https://laracasts.com"
                                class="flex items-start gap-4 rounded-lg bg-white p-6 shadow-[0px_14px_34px_0px_rgba(0,0,0,0.08)] ring-1 ring-white/[0.05] transition duration-300 hover:text-black/70 hover:ring-black/20 focus:outline-none focus-visible:ring-[#FF2D20] lg:pb-10 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:text-white/70 dark:hover:ring-zinc-700 dark:focus-visible:ring-[#FF2D20]"
                            >
                                <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#FF2D20]/10 sm:size-16">
                                    <svg class="size-5 sm:size-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><g fill="#FF2D20"><path d="M24 8.25a.5.5 0 0 0-.5-.5H.5a.5.5 0 0 0-.5.5v12a2.5 2.5 0 0 0 2.5 2.5h19a2.5 2.5 0 0 0 2.5-2.5v-12Zm-7.765 5.868a1.221 1.221 0 0 1 0 2.264l-6.626 2.776A1.153 1.153 0 0 1 8 18.123v-5.746a1.151 1.151 0 0 1 1.609-1.035l6.626 2.776ZM19.564 1.677a.25.25 0 0 0-.177-.427H15.6a.106.106 0 0 0-.072.03l-4.54 4.543a.25.25 0 0 0 .177.427h3.783c.027 0 .054-.01.073-.03l4.543-4.543ZM22.071 1.318a.047.047 0 0 0-.045.013l-4.492 4.492a.249.249 0 0 0 .038.385.25.25 0 0 0 .14.042h5.784a.5.5 0 0 0 .5-.5v-2a2.5 2.5 0 0 0-1.925-2.432ZM13.014 1.677a.25.25 0 0 0-.178-.427H9.101a.106.106 0 0 0-.073.03l-4.54 4.543a.25.25 0 0 0 .177.427H8.4a.106.106 0 0 0 .073-.03l4.54-4.543ZM6.513 1.677a.25.25 0 0 0-.177-.427H2.5A2.5 2.5 0 0 0 0 3.75v2a.5.5 0 0 0 .5.5h1.4a.106.106 0 0 0 .073-.03l4.54-4.543Z"/></g></svg>
                                </div>

                                <div class="pt-3 sm:pt-5">
                                    <h2 class="text-xl font-semibold text-black dark:text-white">Laracasts</h2>

                                    <p class="mt-4 text-sm/relaxed">
                                        Laracasts offers thousands of video tutorials on Laravel, PHP, and JavaScript development. Check them out, see for yourself, and massively level up your development skills in the process.
                                    </p>
                                </div>

                                <svg class="size-6 shrink-0 self-center stroke-[#FF2D20]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75"/></svg>
                            </a>

                            <a
                                href="https://laravel-news.com"
                                class="flex items-start gap-4 rounded-lg bg-white p-6 shadow-[0px_14px_34px_0px_rgba(0,0,0,0.08)] ring-1 ring-white/[0.05] transition duration-300 hover:text-black/70 hover:ring-black/20 focus:outline-none focus-visible:ring-[#FF2D20] lg:pb-10 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:text-white/70 dark:hover:ring-zinc-700 dark:focus-visible:ring-[#FF2D20]"
                            >
                                <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#FF2D20]/10 sm:size-16">
                                    <svg class="size-5 sm:size-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><g fill="#FF2D20"><path d="M8.75 4.5H5.5c-.69 0-1.25.56-1.25 1.25v4.75c0 .69.56 1.25 1.25 1.25h3.25c.69 0 1.25-.56 1.25-1.25V5.75c0-.69-.56-1.25-1.25-1.25Z"/><path d="M24 10a3 3 0 0 0-3-3h-2V2.5a2 2 0 0 0-2-2H2a2 2 0 0 0-2 2V20a3.5 3.5 0 0 0 3.5 3.5h17A3.5 3.5 0 0 0 24 20V10ZM3.5 21.5A1.5 1.5 0 0 1 2 20V3a.5.5 0 0 1 .5-.5h14a.5.5 0 0 1 .5.5v17c0 .295.037.588.11.874a.5.5 0 0 1-.484.625L3.5 21.5ZM22 20a1.5 1.5 0 1 1-3 0V9.5a.5.5 0 0 1 .5-.5H21a1 1 0 0 1 1 1v10Z"/><path d="M12.751 6.047h2a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-.75.75h-2A.75.75 0 0 1 12 7.3v-.5a.75.75 0 0 1 .751-.753ZM12.751 10.047h2a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-.75.75h-2A.75.75 0 0 1 12 11.3v-.5a.75.75 0 0 1 .751-.753ZM4.751 14.047h10a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-.75.75h-10A.75.75 0 0 1 4 15.3v-.5a.75.75 0 0 1 .751-.753ZM4.75 18.047h7.5a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-.75.75h-7.5A.75.75 0 0 1 4 19.3v-.5a.75.75 0 0 1 .75-.753Z"/></g></svg>
                                </div>

                                <div class="pt-3 sm:pt-5">
                                    <h2 class="text-xl font-semibold text-black dark:text-white">Laravel News</h2>

                                    <p class="mt-4 text-sm/relaxed">
                                        Laravel News is a community driven portal and newsletter aggregating all of the latest and most important news in the Laravel ecosystem, including new package releases and tutorials.
                                    </p>
                                </div>

                                <svg class="size-6 shrink-0 self-center stroke-[#FF2D20]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75"/></svg>
                            </a>

                            <div class="flex items-start gap-4 rounded-lg bg-white p-6 shadow-[0px_14px_34px_0px_rgba(0,0,0,0.08)] ring-1 ring-white/[0.05] transition duration-300 hover:text-black/70 hover:ring-black/20 focus:outline-none focus-visible:ring-[#FF2D20] lg:pb-10 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:text-white/70 dark:hover:ring-zinc-700 dark:focus-visible:ring-[#FF2D20]">
                                <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#FF2D20]/10 sm:size-16">
                                    <svg class="size-5 sm:size-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <g fill="#FF2D20">
                                            <path
                                                d="M16.597 12.635a.247.247 0 0 0-.08-.237 2.234 2.234 0 0 1-.769-1.68c.001-.195.03-.39.084-.578a.25.25 0 0 0-.09-.267 8.8 8.8 0 0 0-4.826-1.66.25.25 0 0 0-.268.181 2.5 2.5 0 0 1-2.4 1.824.045.045 0 0 0-.045.037 12.255 12.255 0 0 0-.093 3.86.251.251 0 0 0 .208.214c2.22.366 4.367 1.08 6.362 2.118a.252.252 0 0 0 .32-.079 10.09 10.09 0 0 0 1.597-3.733ZM13.616 17.968a.25.25 0 0 0-.063-.407A19.697 19.697 0 0 0 8.91 15.98a.25.25 0 0 0-.287.325c.151.455.334.898.548 1.328.437.827.981 1.594 1.619 2.28a.249.249 0 0 0 .32.044 29.13 29.13 0 0 0 2.506-1.99ZM6.303 14.105a.25.25 0 0 0 .265-.274 13.048 13.048 0 0 1 .205-4.045.062.062 0 0 0-.022-.07 2.5 2.5 0 0 1-.777-.982.25.25 0 0 0-.271-.149 11 11 0 0 0-5.6 2.815.255.255 0 0 0-.075.163c-.008.135-.02.27-.02.406.002.8.084 1.598.246 2.381a.25.25 0 0 0 .303.193 19.924 19.924 0 0 1 5.746-.438ZM9.228 20.914a.25.25 0 0 0 .1-.393 11.53 11.53 0 0 1-1.5-2.22 12.238 12.238 0 0 1-.91-2.465.248.248 0 0 0-.22-.187 18.876 18.876 0 0 0-5.69.33.249.249 0 0 0-.179.336c.838 2.142 2.272 4 4.132 5.353a.254.254 0 0 0 .15.048c1.41-.01 2.807-.282 4.117-.802ZM18.93 12.957l-.005-.008a.25.25 0 0 0-.268-.082 2.21 2.21 0 0 1-.41.081.25.25 0 0 0-.217.2c-.582 2.66-2.127 5.35-5.75 7.843a.248.248 0 0 0-.09.299.25.25 0 0 0 .065.091 28.703 28.703 0 0 0 2.662 2.12.246.246 0 0 0 .209.037c2.579-.701 4.85-2.242 6.456-4.378a.25.25 0 0 0 .048-.189 13.51 13.51 0 0 0-2.7-6.014ZM5.702 7.058a.254.254 0 0 0 .2-.165A2.488 2.488 0 0 1 7.98 5.245a.093.093 0 0 0 .078-.062 19.734 19.734 0 0 1 3.055-4.74.25.25 0 0 0-.21-.41 12.009 12.009 0 0 0-10.4 8.558.25.25 0 0 0 .373.281 12.912 12.912 0 0 1 4.826-1.814ZM10.773 22.052a.25.25 0 0 0-.28-.046c-.758.356-1.55.635-2.365.833a.25.25 0 0 0-.022.48c1.252.43 2.568.65 3.893.65.1 0 .2 0 .3-.008a.25.25 0 0 0 .147-.444c-.526-.424-1.1-.917-1.673-1.465ZM18.744 8.436a.249.249 0 0 0 .15.228 2.246 2.246 0 0 1 1.352 2.054c0 .337-.08.67-.23.972a.25.25 0 0 0 .042.28l.007.009a15.016 15.016 0 0 1 2.52 4.6.25.25 0 0 0 .37.132.25.25 0 0 0 .096-.114c.623-1.464.944-3.039.945-4.63a12.005 12.005 0 0 0-5.78-10.258.25.25 0 0 0-.373.274c.547 2.109.85 4.274.901 6.453ZM9.61 5.38a.25.25 0 0 0 .08.31c.34.24.616.561.8.935a.25.25 0 0 0 .3.127.631.631 0 0 1 .206-.034c2.054.078 4.036.772 5.69 1.991a.251.251 0 0 0 .267.024c.046-.024.093-.047.141-.067a.25.25 0 0 0 .151-.23A29.98 29.98 0 0 0 15.957.764a.25.25 0 0 0-.16-.164 11.924 11.924 0 0 0-2.21-.518.252.252 0 0 0-.215.076A22.456 22.456 0 0 0 9.61 5.38Z"
                                            />
                                        </g>
                                    </svg>
                                </div>

                                <div class="pt-3 sm:pt-5">
                                    <h2 class="text-xl font-semibold text-black dark:text-white">Vibrant Ecosystem</h2>

                                    <p class="mt-4 text-sm/relaxed">
                                        Laravel's robust library of first-party tools and libraries, such as <a href="https://forge.laravel.com" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white dark:focus-visible:ring-[#FF2D20]">Forge</a>, <a href="https://vapor.laravel.com" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Vapor</a>, <a href="https://nova.laravel.com" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Nova</a>, <a href="https://envoyer.io" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Envoyer</a>, and <a href="https://herd.laravel.com" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Herd</a> help you take your projects to the next level. Pair them with powerful open source libraries like <a href="https://laravel.com/docs/billing" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Cashier</a>, <a href="https://laravel.com/docs/dusk" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Dusk</a>, <a href="https://laravel.com/docs/broadcasting" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Echo</a>, <a href="https://laravel.com/docs/horizon" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Horizon</a>, <a href="https://laravel.com/docs/sanctum" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Sanctum</a>, <a href="https://laravel.com/docs/telescope" class="rounded-sm underline hover:text-black focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FF2D20] dark:hover:text-white">Telescope</a>, and more.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </main>

                    <footer class="py-16 text-center text-sm text-black dark:text-white/70">
                        Laravel v{{ Illuminate\Foundation\Application::VERSION }} (PHP v{{ PHP_VERSION }})
                    </footer>
                </div>
            </div>
        </div>
    </body>
</html>

```

# backend/routes/api.php

```php
<?php

use App\Http\Controllers\Api\ArticleController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\SourceController;
use App\Http\Controllers\Api\UserPreferenceController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    // Auth routes
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);

    // Public routes
    Route::get('/articles', [ArticleController::class, 'index']);
    Route::get('/articles/{article}', [ArticleController::class, 'show']);
    Route::get('/categories', [CategoryController::class, 'index']);
    Route::get('/sources', [SourceController::class, 'index']);

    // Protected routes
    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout']);

        // User preferences
        Route::get('/preferences', [UserPreferenceController::class, 'show']);
        Route::post('/preferences', [UserPreferenceController::class, 'store']);
        Route::put('/preferences', [UserPreferenceController::class, 'update']);

        // Personal feed
        Route::get('/feed', [ArticleController::class, 'userFeed']);
    });
});

```

# backend/routes/console.php

```php
<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote')->hourly();

```

# backend/routes/web.php

```php
<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

```

# backend/storage/app/.gitignore

```
*
!private/
!public/
!.gitignore

```

# backend/storage/app/private/.gitignore

```
*
!.gitignore

```

# backend/storage/app/public/.gitignore

```
*
!.gitignore

```

# backend/storage/framework/.gitignore

```
compiled.php
config.php
down
events.scanned.php
maintenance.php
routes.php
routes.scanned.php
schedule-*
services.json

```

# backend/storage/framework/cache/.gitignore

```
*
!data/
!.gitignore

```

# backend/storage/framework/cache/data/.gitignore

```
*
!.gitignore

```

# backend/storage/framework/sessions/.gitignore

```
*
!.gitignore

```

# backend/storage/framework/testing/.gitignore

```
*
!.gitignore

```

# backend/storage/framework/views/.gitignore

```
*
!.gitignore

```

# backend/storage/framework/views/7e33b743a27113c4160f4c552f8b4db1.php

```php
<?php if (isset($component)) { $__componentOriginal74daf2d0a9c625ad90327a6043d15980 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal74daf2d0a9c625ad90327a6043d15980 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.card','data' => ['class' => 'mt-6 overflow-x-auto']] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::card'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['class' => 'mt-6 overflow-x-auto']); ?>
    <div
        x-data="{
            includeVendorFrames: false,
            index: <?php echo e($exception->defaultFrame()); ?>,
        }"
    >
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-3" x-clock>
            <?php if (isset($component)) { $__componentOriginal92c1a431b4816bac5d5a20d0fc1238ab = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal92c1a431b4816bac5d5a20d0fc1238ab = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.trace','data' => ['exception' => $exception]] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::trace'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['exception' => \Illuminate\View\Compilers\BladeCompiler::sanitizeComponentAttribute($exception)]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal92c1a431b4816bac5d5a20d0fc1238ab)): ?>
<?php $attributes = $__attributesOriginal92c1a431b4816bac5d5a20d0fc1238ab; ?>
<?php unset($__attributesOriginal92c1a431b4816bac5d5a20d0fc1238ab); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal92c1a431b4816bac5d5a20d0fc1238ab)): ?>
<?php $component = $__componentOriginal92c1a431b4816bac5d5a20d0fc1238ab; ?>
<?php unset($__componentOriginal92c1a431b4816bac5d5a20d0fc1238ab); ?>
<?php endif; ?>
            <?php if (isset($component)) { $__componentOriginala2de13eefed6710e7b4064d57c6d0e47 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginala2de13eefed6710e7b4064d57c6d0e47 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.editor','data' => ['exception' => $exception]] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::editor'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['exception' => \Illuminate\View\Compilers\BladeCompiler::sanitizeComponentAttribute($exception)]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginala2de13eefed6710e7b4064d57c6d0e47)): ?>
<?php $attributes = $__attributesOriginala2de13eefed6710e7b4064d57c6d0e47; ?>
<?php unset($__attributesOriginala2de13eefed6710e7b4064d57c6d0e47); ?>
<?php endif; ?>
<?php if (isset($__componentOriginala2de13eefed6710e7b4064d57c6d0e47)): ?>
<?php $component = $__componentOriginala2de13eefed6710e7b4064d57c6d0e47; ?>
<?php unset($__componentOriginala2de13eefed6710e7b4064d57c6d0e47); ?>
<?php endif; ?>
        </div>
    </div>
 <?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal74daf2d0a9c625ad90327a6043d15980)): ?>
<?php $attributes = $__attributesOriginal74daf2d0a9c625ad90327a6043d15980; ?>
<?php unset($__attributesOriginal74daf2d0a9c625ad90327a6043d15980); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal74daf2d0a9c625ad90327a6043d15980)): ?>
<?php $component = $__componentOriginal74daf2d0a9c625ad90327a6043d15980; ?>
<?php unset($__componentOriginal74daf2d0a9c625ad90327a6043d15980); ?>
<?php endif; ?>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/trace-and-editor.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/8b77322ea40de4645844c2e3622c3810.php

```php
<?php use \Illuminate\Foundation\Exceptions\Renderer\Renderer; ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
    />

    <title><?php echo e(config('app.name', 'Laravel')); ?></title>

    <link rel="icon" type="image/svg+xml"
          href="data:image/svg+xml,%3Csvg viewBox='0 -.11376601 49.74245785 51.31690859' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='m49.626 11.564a.809.809 0 0 1 .028.209v10.972a.8.8 0 0 1 -.402.694l-9.209 5.302v10.509c0 .286-.152.55-.4.694l-19.223 11.066c-.044.025-.092.041-.14.058-.018.006-.035.017-.054.022a.805.805 0 0 1 -.41 0c-.022-.006-.042-.018-.063-.026-.044-.016-.09-.03-.132-.054l-19.219-11.066a.801.801 0 0 1 -.402-.694v-32.916c0-.072.01-.142.028-.21.006-.023.02-.044.028-.067.015-.042.029-.085.051-.124.015-.026.037-.047.055-.071.023-.032.044-.065.071-.093.023-.023.053-.04.079-.06.029-.024.055-.05.088-.069h.001l9.61-5.533a.802.802 0 0 1 .8 0l9.61 5.533h.002c.032.02.059.045.088.068.026.02.055.038.078.06.028.029.048.062.072.094.017.024.04.045.054.071.023.04.036.082.052.124.008.023.022.044.028.068a.809.809 0 0 1 .028.209v20.559l8.008-4.611v-10.51c0-.07.01-.141.028-.208.007-.024.02-.045.028-.068.016-.042.03-.085.052-.124.015-.026.037-.047.054-.071.024-.032.044-.065.072-.093.023-.023.052-.04.078-.06.03-.024.056-.05.088-.069h.001l9.611-5.533a.801.801 0 0 1 .8 0l9.61 5.533c.034.02.06.045.09.068.025.02.054.038.077.06.028.029.048.062.072.094.018.024.04.045.054.071.023.039.036.082.052.124.009.023.022.044.028.068zm-1.574 10.718v-9.124l-3.363 1.936-4.646 2.675v9.124l8.01-4.611zm-9.61 16.505v-9.13l-4.57 2.61-13.05 7.448v9.216zm-36.84-31.068v31.068l17.618 10.143v-9.214l-9.204-5.209-.003-.002-.004-.002c-.031-.018-.057-.044-.086-.066-.025-.02-.054-.036-.076-.058l-.002-.003c-.026-.025-.044-.056-.066-.084-.02-.027-.044-.05-.06-.078l-.001-.003c-.018-.03-.029-.066-.042-.1-.013-.03-.03-.058-.038-.09v-.001c-.01-.038-.012-.078-.016-.117-.004-.03-.012-.06-.012-.09v-21.483l-4.645-2.676-3.363-1.934zm8.81-5.994-8.007 4.609 8.005 4.609 8.006-4.61-8.006-4.608zm4.164 28.764 4.645-2.674v-20.096l-3.363 1.936-4.646 2.675v20.096zm24.667-23.325-8.006 4.609 8.006 4.609 8.005-4.61zm-.801 10.605-4.646-2.675-3.363-1.936v9.124l4.645 2.674 3.364 1.937zm-18.422 20.561 11.743-6.704 5.87-3.35-8-4.606-9.211 5.303-8.395 4.833z' fill='%23ff2d20'/%3E%3C/svg%3E" />

    <link
        href="https://fonts.bunny.net/css?family=figtree:300,400,500,600"
        rel="stylesheet"
    />

    <?php echo Renderer::css(); ?>


    <style>
        <?php $__currentLoopData = $exception->frames(); $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $frame): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); ?>
            #frame-<?php echo e($loop->index); ?> .hljs-ln-line[data-line-number='<?php echo e($frame->line()); ?>'] {
                background-color: rgba(242, 95, 95, 0.4);
            }
        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); ?>
    </style>
</head>
<body class="bg-gray-200/80 font-sans antialiased dark:bg-gray-950/95">
    <?php echo e($slot); ?>


    <?php echo Renderer::js(); ?>


    <script>
        !function(r,o){"use strict";var e,i="hljs-ln",l="hljs-ln-line",h="hljs-ln-code",s="hljs-ln-numbers",c="hljs-ln-n",m="data-line-number",a=/\r\n|\r|\n/g;function u(e){for(var n=e.toString(),t=e.anchorNode;"TD"!==t.nodeName;)t=t.parentNode;for(var r=e.focusNode;"TD"!==r.nodeName;)r=r.parentNode;var o=parseInt(t.dataset.lineNumber),a=parseInt(r.dataset.lineNumber);if(o==a)return n;var i,l=t.textContent,s=r.textContent;for(a<o&&(i=o,o=a,a=i,i=l,l=s,s=i);0!==n.indexOf(l);)l=l.slice(1);for(;-1===n.lastIndexOf(s);)s=s.slice(0,-1);for(var c=l,u=function(e){for(var n=e;"TABLE"!==n.nodeName;)n=n.parentNode;return n}(t),d=o+1;d<a;++d){var f=p('.{0}[{1}="{2}"]',[h,m,d]);c+="\n"+u.querySelector(f).textContent}return c+="\n"+s}function n(e){try{var n=o.querySelectorAll("code.hljs,code.nohighlight");for(var t in n)n.hasOwnProperty(t)&&(n[t].classList.contains("nohljsln")||d(n[t],e))}catch(e){r.console.error("LineNumbers error: ",e)}}function d(e,n){"object"==typeof e&&r.setTimeout(function(){e.innerHTML=f(e,n)},0)}function f(e,n){var t,r,o=(t=e,{singleLine:function(e){return!!e.singleLine&&e.singleLine}(r=(r=n)||{}),startFrom:function(e,n){var t=1;isFinite(n.startFrom)&&(t=n.startFrom);var r=function(e,n){return e.hasAttribute(n)?e.getAttribute(n):null}(e,"data-ln-start-from");return null!==r&&(t=function(e,n){if(!e)return n;var t=Number(e);return isFinite(t)?t:n}(r,1)),t}(t,r)});return function e(n){var t=n.childNodes;for(var r in t){var o;t.hasOwnProperty(r)&&(o=t[r],0<(o.textContent.trim().match(a)||[]).length&&(0<o.childNodes.length?e(o):v(o.parentNode)))}}(e),function(e,n){var t=g(e);""===t[t.length-1].trim()&&t.pop();if(1<t.length||n.singleLine){for(var r="",o=0,a=t.length;o<a;o++)r+=p('<tr><td class="{0} {1}" {3}="{5}"><div class="{2}" {3}="{5}"></div></td><td class="{0} {4}" {3}="{5}">{6}</td></tr>',[l,s,c,m,h,o+n.startFrom,0<t[o].length?t[o]:" "]);return p('<table class="{0}">{1}</table>',[i,r])}return e}(e.innerHTML,o)}function v(e){var n=e.className;if(/hljs-/.test(n)){for(var t=g(e.innerHTML),r=0,o="";r<t.length;r++){o+=p('<span class="{0}">{1}</span>\n',[n,0<t[r].length?t[r]:" "])}e.innerHTML=o.trim()}}function g(e){return 0===e.length?[]:e.split(a)}function p(e,t){return e.replace(/\{(\d+)\}/g,function(e,n){return void 0!==t[n]?t[n]:e})}r.hljs?(r.hljs.initLineNumbersOnLoad=function(e){"interactive"===o.readyState||"complete"===o.readyState?n(e):r.addEventListener("DOMContentLoaded",function(){n(e)})},r.hljs.lineNumbersBlock=d,r.hljs.lineNumbersValue=function(e,n){if("string"!=typeof e)return;var t=document.createElement("code");return t.innerHTML=e,f(t,n)},(e=o.createElement("style")).type="text/css",e.innerHTML=p(".{0}{border-collapse:collapse}.{0} td{padding:0}.{1}:before{content:attr({2})}",[i,c,m]),o.getElementsByTagName("head")[0].appendChild(e)):r.console.error("highlight.js not detected!"),document.addEventListener("copy",function(e){var n,t=window.getSelection();!function(e){for(var n=e;n;){if(n.className&&-1!==n.className.indexOf("hljs-ln-code"))return 1;n=n.parentNode}}(t.anchorNode)||(n=-1!==window.navigator.userAgent.indexOf("Edge")?u(t):t.toString(),e.clipboardData.setData("text/plain",n),e.preventDefault())})}(window,document);

        hljs.initLineNumbersOnLoad()

        window.addEventListener('load', function() {
            document.querySelectorAll('.renderer').forEach(function(element, index) {
                if (index > 0) {
                    element.remove();
                }
            });

            document.querySelector('.default-highlightable-code').style.display = 'block';

            document.querySelectorAll('.highlightable-code').forEach(function(element) {
                element.style.display = 'block';
            })
        });
    </script>
</body>
</html>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/layout.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/09ee47cb6b2ead6fe59c09eda6d900b2.php

```php
<?php if (isset($component)) { $__componentOriginal74daf2d0a9c625ad90327a6043d15980 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal74daf2d0a9c625ad90327a6043d15980 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.card','data' => []] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::card'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes([]); ?>
    <div class="md:flex md:items-center md:justify-between md:gap-2">
        <div class="min-w-0">
            <div class="inline-block rounded-full bg-red-500/20 px-3 py-2 max-w-full text-sm font-bold leading-5 text-red-500 truncate lg:text-base dark:bg-red-500/20">
                <span class="hidden md:inline">
                    <?php echo e($exception->class()); ?>

                </span>
                <span class="md:hidden">
                    <?php echo e(implode(' ', array_slice(explode('\\', $exception->class()), -1))); ?>

                </span>
            </div>
            <div class="mt-4 text-lg font-semibold text-gray-900 break-words dark:text-white lg:text-2xl">
                <?php echo e($exception->message()); ?>

            </div>
        </div>

        <div class="hidden text-right shrink-0 md:block md:min-w-64 md:max-w-80">
            <div>
                <span class="inline-block rounded-full bg-gray-200 px-3 py-2 text-sm leading-5 text-gray-900 max-w-full truncate dark:bg-gray-800 dark:text-white">
                    <?php echo e($exception->request()->method()); ?> <?php echo e($exception->request()->httpHost()); ?>

                </span>
            </div>
            <div class="px-4">
                <span class="text-sm text-gray-500 dark:text-gray-400">PHP <?php echo e(PHP_VERSION); ?> — Laravel <?php echo e(app()->version()); ?></span>
            </div>
        </div>
    </div>
 <?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal74daf2d0a9c625ad90327a6043d15980)): ?>
<?php $attributes = $__attributesOriginal74daf2d0a9c625ad90327a6043d15980; ?>
<?php unset($__attributesOriginal74daf2d0a9c625ad90327a6043d15980); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal74daf2d0a9c625ad90327a6043d15980)): ?>
<?php $component = $__componentOriginal74daf2d0a9c625ad90327a6043d15980; ?>
<?php unset($__componentOriginal74daf2d0a9c625ad90327a6043d15980); ?>
<?php endif; ?>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/header.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/13908c918157ccfc7c05c05195757833.php

```php
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" style="margin-bottom: -8px;">
    <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
</svg>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/icons/chevron-down.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/931737c889bcb943f8fc79654d164835.php

```php
<section
    <?php echo e($attributes->merge(['class' => "@container flex flex-col p-6 sm:p-12 bg-white dark:bg-gray-900/80 text-gray-900 dark:text-gray-100 rounded-lg default:col-span-full default:lg:col-span-6 default:row-span-1 dark:ring-1 dark:ring-gray-800 shadow-xl"])); ?>

>
    <?php echo e($slot); ?>

</section>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/card.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/368072756c233ac30f0cf310e266ea82.php

```php
<svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke-width="1.5"
    stroke="currentColor"
    <?php echo e($attributes); ?>

>
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
</svg>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/icons/sun.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/419551074a50fbe34ef86a0e07ca7190.php

```php
<div class="hidden overflow-x-auto sm:col-span-1 lg:block">
    <div
        class="h-[35.5rem] scrollbar-hidden trace text-sm text-gray-400 dark:text-gray-300"
    >
        <div class="mb-2 inline-block rounded-full bg-red-500/20 px-3 py-2 dark:bg-red-500/20 sm:col-span-1">
            <button
                @click="includeVendorFrames = !includeVendorFrames"
                class="inline-flex items-center font-bold leading-5 text-red-500"
            >
                <span x-show="includeVendorFrames">Collapse</span>
                <span
                    x-cloak
                    x-show="!includeVendorFrames"
                    >Expand</span
                >
                <span class="ml-1">vendor frames</span>

                <div class="flex flex-col ml-1 -mt-2" x-cloak x-show="includeVendorFrames">
                    <?php if (isset($component)) { $__componentOriginal707ceba27255eae48fdb0f3529710ddf = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal707ceba27255eae48fdb0f3529710ddf = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.chevron-down','data' => []] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.chevron-down'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes([]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal707ceba27255eae48fdb0f3529710ddf)): ?>
<?php $attributes = $__attributesOriginal707ceba27255eae48fdb0f3529710ddf; ?>
<?php unset($__attributesOriginal707ceba27255eae48fdb0f3529710ddf); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal707ceba27255eae48fdb0f3529710ddf)): ?>
<?php $component = $__componentOriginal707ceba27255eae48fdb0f3529710ddf; ?>
<?php unset($__componentOriginal707ceba27255eae48fdb0f3529710ddf); ?>
<?php endif; ?>
                    <?php if (isset($component)) { $__componentOriginal14b1cc5db95fcca4a0f06445821cff39 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal14b1cc5db95fcca4a0f06445821cff39 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.chevron-up','data' => []] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.chevron-up'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes([]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal14b1cc5db95fcca4a0f06445821cff39)): ?>
<?php $attributes = $__attributesOriginal14b1cc5db95fcca4a0f06445821cff39; ?>
<?php unset($__attributesOriginal14b1cc5db95fcca4a0f06445821cff39); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal14b1cc5db95fcca4a0f06445821cff39)): ?>
<?php $component = $__componentOriginal14b1cc5db95fcca4a0f06445821cff39; ?>
<?php unset($__componentOriginal14b1cc5db95fcca4a0f06445821cff39); ?>
<?php endif; ?>
                </div>

                <div class="flex flex-col ml-1 -mt-2" x-cloak x-show="! includeVendorFrames">
                    <?php if (isset($component)) { $__componentOriginal14b1cc5db95fcca4a0f06445821cff39 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal14b1cc5db95fcca4a0f06445821cff39 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.chevron-up','data' => []] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.chevron-up'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes([]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal14b1cc5db95fcca4a0f06445821cff39)): ?>
<?php $attributes = $__attributesOriginal14b1cc5db95fcca4a0f06445821cff39; ?>
<?php unset($__attributesOriginal14b1cc5db95fcca4a0f06445821cff39); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal14b1cc5db95fcca4a0f06445821cff39)): ?>
<?php $component = $__componentOriginal14b1cc5db95fcca4a0f06445821cff39; ?>
<?php unset($__componentOriginal14b1cc5db95fcca4a0f06445821cff39); ?>
<?php endif; ?>
                    <?php if (isset($component)) { $__componentOriginal707ceba27255eae48fdb0f3529710ddf = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal707ceba27255eae48fdb0f3529710ddf = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.chevron-down','data' => []] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.chevron-down'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes([]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal707ceba27255eae48fdb0f3529710ddf)): ?>
<?php $attributes = $__attributesOriginal707ceba27255eae48fdb0f3529710ddf; ?>
<?php unset($__attributesOriginal707ceba27255eae48fdb0f3529710ddf); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal707ceba27255eae48fdb0f3529710ddf)): ?>
<?php $component = $__componentOriginal707ceba27255eae48fdb0f3529710ddf; ?>
<?php unset($__componentOriginal707ceba27255eae48fdb0f3529710ddf); ?>
<?php endif; ?>
                </div>
            </button>
        </div>

        <div class="mb-12 space-y-2">
            <?php $__currentLoopData = $exception->frames(); $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $frame): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); ?>
                <?php if(! $frame->isFromVendor()): ?>
                    <?php
                        $vendorFramesCollapsed = $exception->frames()->take($loop->index)->reverse()->takeUntil(fn ($frame) => ! $frame->isFromVendor());
                    ?>

                    <div x-show="! includeVendorFrames">
                        <?php if($vendorFramesCollapsed->isNotEmpty()): ?>
                            <div class="text-gray-500">
                                <?php echo e($vendorFramesCollapsed->count()); ?> vendor frame<?php echo e($vendorFramesCollapsed->count() > 1 ? 's' : ''); ?> collapsed
                            </div>
                        <?php endif; ?>
                    </div>
                <?php endif; ?>

                <button
                    class="w-full text-left dark:border-gray-900"
                    x-show="<?php echo e($frame->isFromVendor() ? 'includeVendorFrames' : 'true'); ?>"
                    @click="index = <?php echo e($loop->index); ?>"
                >
                    <div
                        x-bind:class="
                            index === <?php echo e($loop->index); ?>

                                ? 'rounded-r-md bg-gray-100 dark:bg-gray-800 border-l dark:border dark:border-gray-700 border-l-red-500 dark:border-l-red-500'
                                : 'hover:bg-gray-100/75 dark:hover:bg-gray-800/75'
                        "
                    >
                        <div class="scrollbar-hidden overflow-x-auto border-l-2 border-transparent p-2">
                            <div class="nowrap text-gray-900 dark:text-gray-300">
                                <span class="inline-flex items-baseline">
                                    <span class="text-gray-900 dark:text-gray-300"><?php echo e($frame->source()); ?></span>
                                    <span class="font-mono text-xs">:<?php echo e($frame->line()); ?></span>
                                </span>
                            </div>
                            <div class="text-gray-500 dark:text-gray-400">
                                <?php echo e($exception->frames()->get($loop->index + 1)?->callable()); ?>

                            </div>
                        </div>
                    </div>
                </button>

                <?php if(! $frame->isFromVendor() && $exception->frames()->slice($loop->index + 1)->filter(fn ($frame) => ! $frame->isFromVendor())->isEmpty()): ?>
                    <?php if($exception->frames()->slice($loop->index + 1)->count()): ?>
                        <div x-show="! includeVendorFrames">
                            <div class="text-gray-500">
                                <?php echo e($exception->frames()->slice($loop->index + 1)->count()); ?> vendor
                                frame<?php echo e($exception->frames()->slice($loop->index + 1)->count() > 1 ? 's' : ''); ?> collapsed
                            </div>
                        </div>
                    <?php endif; ?>
                <?php endif; ?>
            <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); ?>
        </div>
    </div>
</div>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/trace.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/a6e017772dac798c684f8ca4ea6a433e.php

```php
<svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke-width="1.5"
    stroke="currentColor"
    <?php echo e($attributes); ?>

>
    <path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
</svg>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/icons/computer-desktop.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/a43dffac7f28722de66800e4b9a5f5b9.php

```php
<?php use \Illuminate\Support\Str; ?>
<?php if (isset($component)) { $__componentOriginal74daf2d0a9c625ad90327a6043d15980 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal74daf2d0a9c625ad90327a6043d15980 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.card','data' => ['class' => 'mt-6 overflow-x-auto']] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::card'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['class' => 'mt-6 overflow-x-auto']); ?>
    <div>
        <span class="text-xl font-bold lg:text-2xl">Request</span>
    </div>

    <div class="mt-2">
        <span><?php echo e($exception->request()->method()); ?></span>
        <span class="text-gray-500"><?php echo e(Str::start($exception->request()->path(), '/')); ?></span>
    </div>

    <div class="mt-4">
        <span class="font-semibold text-gray-900 dark:text-white">Headers</span>
    </div>

    <dl class="mt-1 grid grid-cols-1 rounded border dark:border-gray-800">
        <?php $__empty_1 = true; $__currentLoopData = $exception->requestHeaders(); $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $key => $value): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
            <div class="flex items-center gap-2 <?php echo e($loop->first ? '' : 'border-t'); ?> dark:border-gray-800">
                <span
                    data-tippy-content="<?php echo e($key); ?>"
                    class="lg:text-md w-[8rem] flex-none cursor-pointer truncate border-r px-5 py-3 text-sm dark:border-gray-800 lg:w-[12rem]"
                >
                    <?php echo e($key); ?>

                </span>
                <span
                    class="min-w-0 flex-grow"
                    style="
                        -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 3rem), transparent calc(100% - 1rem));
                    "
                >
                    <pre class="scrollbar-hidden overflow-y-hidden text-xs lg:text-sm"><code class="px-5 py-3 overflow-y-hidden scrollbar-hidden max-h-32 overflow-x-scroll scrollbar-hidden-x"><?php echo e($value); ?></code></pre>
                </span>
            </div>
        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
            <span
                class="min-w-0 flex-grow"
                style="-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 3rem), transparent calc(100% - 1rem))"
            >
                <pre class="scrollbar-hidden mx-5 my-3 overflow-y-hidden text-xs lg:text-sm"><code class="overflow-y-hidden scrollbar-hidden overflow-x-scroll scrollbar-hidden-x">No headers data</code></pre>
            </span>
        <?php endif; ?>
    </dl>

    <div class="mt-4">
        <span class="font-semibold text-gray-900 dark:text-white">Body</span>
    </div>

    <div class="mt-1 rounded border dark:border-gray-800">
        <div class="flex items-center">
            <span
                class="min-w-0 flex-grow"
                style="-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 3rem), transparent calc(100% - 1rem))"
            >
                <pre class="scrollbar-hidden mx-5 my-3 overflow-y-hidden text-xs lg:text-sm"><code class="overflow-y-hidden scrollbar-hidden overflow-x-scroll scrollbar-hidden-x"><?php echo $exception->requestBody() ?: 'No body data'; ?></code></pre>
            </span>
        </div>
    </div>

 <?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal74daf2d0a9c625ad90327a6043d15980)): ?>
<?php $attributes = $__attributesOriginal74daf2d0a9c625ad90327a6043d15980; ?>
<?php unset($__attributesOriginal74daf2d0a9c625ad90327a6043d15980); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal74daf2d0a9c625ad90327a6043d15980)): ?>
<?php $component = $__componentOriginal74daf2d0a9c625ad90327a6043d15980; ?>
<?php unset($__componentOriginal74daf2d0a9c625ad90327a6043d15980); ?>
<?php endif; ?>

<?php if (isset($component)) { $__componentOriginal74daf2d0a9c625ad90327a6043d15980 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal74daf2d0a9c625ad90327a6043d15980 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.card','data' => ['class' => 'mt-6 overflow-x-auto']] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::card'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['class' => 'mt-6 overflow-x-auto']); ?>
    <div>
        <span class="text-xl font-bold lg:text-2xl">Application</span>
    </div>

    <div class="mt-4">
        <span class="font-semibold text-gray-900 dark:text-white"> Routing </span>
    </div>

    <dl class="mt-1 grid grid-cols-1 rounded border dark:border-gray-800">
        <?php $__empty_1 = true; $__currentLoopData = $exception->applicationRouteContext(); $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $name => $value): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
            <div class="flex items-center gap-2 <?php echo e($loop->first ? '' : 'border-t'); ?> dark:border-gray-800">
                <span
                    data-tippy-content="<?php echo e($name); ?>"
                    class="lg:text-md w-[8rem] flex-none cursor-pointer truncate border-r px-5 py-3 text-sm dark:border-gray-800 lg:w-[12rem]"
                    ><?php echo e($name); ?></span
                >
                <span
                    class="min-w-0 flex-grow"
                    style="
                        -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 3rem), transparent calc(100% - 1rem));
                    "
                >
                    <pre class="scrollbar-hidden overflow-y-hidden text-xs lg:text-sm"><code class="px-5 py-3 overflow-y-hidden scrollbar-hidden max-h-32 overflow-x-scroll scrollbar-hidden-x"><?php echo e($value); ?></code></pre>
                </span>
            </div>
        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
            <span
                class="min-w-0 flex-grow"
                style="-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 3rem), transparent calc(100% - 1rem))"
            >
                <pre class="scrollbar-hidden mx-5 my-3 overflow-y-hidden text-xs lg:text-sm"><code class="overflow-y-hidden scrollbar-hidden overflow-x-scroll scrollbar-hidden-x">No routing data</code></pre>
            </span>
        <?php endif; ?>
    </dl>

    <?php if($routeParametersContext = $exception->applicationRouteParametersContext()): ?>
        <div class="mt-4">
            <span class="text-gray-900 dark:text-white text-sm"> Routing Parameters </span>
        </div>

        <div class="mt-1 rounded border dark:border-gray-800">
            <div class="flex items-center">
                <span
                    class="min-w-0 flex-grow"
                    style="-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 3rem), transparent calc(100% - 1rem))"
                >
                    <pre class="scrollbar-hidden mx-5 my-3 overflow-y-hidden text-xs lg:text-sm"><code class="overflow-y-hidden scrollbar-hidden overflow-x-scroll scrollbar-hidden-x"><?php echo $routeParametersContext; ?></code></pre>
                </span>
            </div>
        </div>
    <?php endif; ?>

    <div class="mt-4">
        <span class="font-semibold text-gray-900 dark:text-white"> Database Queries </span>
        <span class="text-xs text-gray-500 dark:text-gray-400">
            <?php if(count($exception->applicationQueries()) === 100): ?>
                only the first 100 queries are displayed
            <?php endif; ?>
        </span>
    </div>

    <dl class="mt-1 grid grid-cols-1 rounded border dark:border-gray-800">
        <?php $__empty_1 = true; $__currentLoopData = $exception->applicationQueries(); $__env->addLoop($__currentLoopData); foreach($__currentLoopData as ['connectionName' => $connectionName, 'sql' => $sql, 'time' => $time]): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
            <div class="flex items-center gap-2 <?php echo e($loop->first ? '' : 'border-t'); ?> dark:border-gray-800">
                <div class="lg:text-md w-[8rem] flex-none truncate border-r px-5 py-3 text-sm dark:border-gray-800 lg:w-[12rem]">
                    <span><?php echo e($connectionName); ?></span>
                    <span class="hidden text-xs text-gray-500 lg:inline-block">(<?php echo e($time); ?> ms)</span>
                </div>
                <span
                    class="min-w-0 flex-grow"
                    style="
                        -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 3rem), transparent calc(100% - 1rem));
                    "
                >
                    <pre class="scrollbar-hidden overflow-y-hidden text-xs lg:text-sm"><code class="px-5 py-3 overflow-y-hidden scrollbar-hidden max-h-32 overflow-x-scroll scrollbar-hidden-x"><?php echo e($sql); ?></code></pre>
                </span>
            </div>
        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
            <span
                class="min-w-0 flex-grow"
                style="-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 3rem), transparent calc(100% - 1rem))"
            >
                <pre class="scrollbar-hidden mx-5 my-3 overflow-y-hidden text-xs lg:text-sm"><code class="overflow-y-hidden scrollbar-hidden overflow-x-scroll scrollbar-hidden-x">No query data</code></pre>
            </span>
        <?php endif; ?>
    </dl>
 <?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal74daf2d0a9c625ad90327a6043d15980)): ?>
<?php $attributes = $__attributesOriginal74daf2d0a9c625ad90327a6043d15980; ?>
<?php unset($__attributesOriginal74daf2d0a9c625ad90327a6043d15980); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal74daf2d0a9c625ad90327a6043d15980)): ?>
<?php $component = $__componentOriginal74daf2d0a9c625ad90327a6043d15980; ?>
<?php unset($__componentOriginal74daf2d0a9c625ad90327a6043d15980); ?>
<?php endif; ?>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/context.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/a120438d505ca9da755be63e962e88d7.php

```php
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" style="margin-bottom: -8px;">
  <path fill-rule="evenodd" d="M9.47 6.47a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L10 8.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06l4.25-4.25Z" clip-rule="evenodd" />
</svg>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/icons/chevron-up.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/a409957c32073e5572a809a8a11b2836.php

```php
<script>

    (function () {
        const darkStyles = document.querySelector('style[data-theme="dark"]')?.textContent
        const lightStyles = document.querySelector('style[data-theme="light"]')?.textContent

        const removeStyles = () => {
            document.querySelector('style[data-theme="dark"]')?.remove()
            document.querySelector('style[data-theme="light"]')?.remove()
        }

        removeStyles()

        setDarkClass = () => {
            removeStyles()

            const isDark = localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)

            isDark ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark')

            if (isDark) {
                document.head.insertAdjacentHTML('beforeend', `<style data-theme="dark">${darkStyles}</style>`)
            } else {
                document.head.insertAdjacentHTML('beforeend', `<style data-theme="light">${lightStyles}</style>`)
            }
        }

        setDarkClass()

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setDarkClass)
    })();
</script>

<div
    class="relative"
    x-data="{
        menu: false,
        theme: localStorage.theme,
        darkMode() {
            this.theme = 'dark'
            localStorage.theme = 'dark'
            setDarkClass()
        },
        lightMode() {
            this.theme = 'light'
            localStorage.theme = 'light'
            setDarkClass()
        },
        systemMode() {
            this.theme = undefined
            localStorage.removeItem('theme')
            setDarkClass()
        },
    }"
    @click.outside="menu = false"
>
    <button
        x-cloak
        class="block rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
        :class="theme ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600 hover:text-gray-500 focus:text-gray-500 dark:hover:text-gray-500 dark:focus:text-gray-500'"
        @click="menu = ! menu"
    >
        <?php if (isset($component)) { $__componentOriginalbfde029a2e31d1ec96b5017ff81a67a7 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginalbfde029a2e31d1ec96b5017ff81a67a7 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.sun','data' => ['class' => 'block h-5 w-5 dark:hidden']] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.sun'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['class' => 'block h-5 w-5 dark:hidden']); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginalbfde029a2e31d1ec96b5017ff81a67a7)): ?>
<?php $attributes = $__attributesOriginalbfde029a2e31d1ec96b5017ff81a67a7; ?>
<?php unset($__attributesOriginalbfde029a2e31d1ec96b5017ff81a67a7); ?>
<?php endif; ?>
<?php if (isset($__componentOriginalbfde029a2e31d1ec96b5017ff81a67a7)): ?>
<?php $component = $__componentOriginalbfde029a2e31d1ec96b5017ff81a67a7; ?>
<?php unset($__componentOriginalbfde029a2e31d1ec96b5017ff81a67a7); ?>
<?php endif; ?>
        <?php if (isset($component)) { $__componentOriginal6dda8ad3ea7f20f6c0a87e7037386745 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal6dda8ad3ea7f20f6c0a87e7037386745 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.moon','data' => ['class' => 'hidden h-5 w-5 dark:block']] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.moon'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['class' => 'hidden h-5 w-5 dark:block']); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal6dda8ad3ea7f20f6c0a87e7037386745)): ?>
<?php $attributes = $__attributesOriginal6dda8ad3ea7f20f6c0a87e7037386745; ?>
<?php unset($__attributesOriginal6dda8ad3ea7f20f6c0a87e7037386745); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal6dda8ad3ea7f20f6c0a87e7037386745)): ?>
<?php $component = $__componentOriginal6dda8ad3ea7f20f6c0a87e7037386745; ?>
<?php unset($__componentOriginal6dda8ad3ea7f20f6c0a87e7037386745); ?>
<?php endif; ?>
    </button>

    <div
        x-show="menu"
        class="absolute right-0 z-10 flex origin-top-right flex-col rounded-md bg-white shadow-xl ring-1 ring-gray-900/5 dark:bg-gray-800"
        style="display: none"
        @click="menu = false"
    >
        <button
            class="flex items-center gap-3 px-4 py-2 hover:rounded-t-md hover:bg-gray-100 dark:hover:bg-gray-700"
            :class="theme === 'light' ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'"
            @click="lightMode()"
        >
            <?php if (isset($component)) { $__componentOriginalbfde029a2e31d1ec96b5017ff81a67a7 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginalbfde029a2e31d1ec96b5017ff81a67a7 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.sun','data' => ['class' => 'h-5 w-5']] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.sun'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['class' => 'h-5 w-5']); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginalbfde029a2e31d1ec96b5017ff81a67a7)): ?>
<?php $attributes = $__attributesOriginalbfde029a2e31d1ec96b5017ff81a67a7; ?>
<?php unset($__attributesOriginalbfde029a2e31d1ec96b5017ff81a67a7); ?>
<?php endif; ?>
<?php if (isset($__componentOriginalbfde029a2e31d1ec96b5017ff81a67a7)): ?>
<?php $component = $__componentOriginalbfde029a2e31d1ec96b5017ff81a67a7; ?>
<?php unset($__componentOriginalbfde029a2e31d1ec96b5017ff81a67a7); ?>
<?php endif; ?>
            Light
        </button>
        <button
            class="flex items-center gap-3 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
            :class="theme === 'dark' ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'"
            @click="darkMode()"
        >
            <?php if (isset($component)) { $__componentOriginal6dda8ad3ea7f20f6c0a87e7037386745 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal6dda8ad3ea7f20f6c0a87e7037386745 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.moon','data' => ['class' => 'h-5 w-5']] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.moon'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['class' => 'h-5 w-5']); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal6dda8ad3ea7f20f6c0a87e7037386745)): ?>
<?php $attributes = $__attributesOriginal6dda8ad3ea7f20f6c0a87e7037386745; ?>
<?php unset($__attributesOriginal6dda8ad3ea7f20f6c0a87e7037386745); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal6dda8ad3ea7f20f6c0a87e7037386745)): ?>
<?php $component = $__componentOriginal6dda8ad3ea7f20f6c0a87e7037386745; ?>
<?php unset($__componentOriginal6dda8ad3ea7f20f6c0a87e7037386745); ?>
<?php endif; ?>
            Dark
        </button>
        <button
            class="flex items-center gap-3 px-4 py-2 hover:rounded-b-md hover:bg-gray-100 dark:hover:bg-gray-700"
            :class="theme === undefined ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'"
            @click="systemMode()"
        >
            <?php if (isset($component)) { $__componentOriginala52e607cb40b8eec566206ff9f3ca13c = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginala52e607cb40b8eec566206ff9f3ca13c = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.icons.computer-desktop','data' => ['class' => 'h-5 w-5']] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::icons.computer-desktop'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['class' => 'h-5 w-5']); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginala52e607cb40b8eec566206ff9f3ca13c)): ?>
<?php $attributes = $__attributesOriginala52e607cb40b8eec566206ff9f3ca13c; ?>
<?php unset($__attributesOriginala52e607cb40b8eec566206ff9f3ca13c); ?>
<?php endif; ?>
<?php if (isset($__componentOriginala52e607cb40b8eec566206ff9f3ca13c)): ?>
<?php $component = $__componentOriginala52e607cb40b8eec566206ff9f3ca13c; ?>
<?php unset($__componentOriginala52e607cb40b8eec566206ff9f3ca13c); ?>
<?php endif; ?>
            System
        </button>
    </div>
</div>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/theme-switcher.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/a3557068ed5b47425d76d1f6f3777346.php

```php
<header class="mt-3 px-5 sm:mt-10">
    <div class="py-3 dark:border-gray-900 sm:py-5">
        <div class="flex items-center justify-between">
            <div class="flex items-center">
                <div class="rounded-full bg-red-500/20 p-4 dark:bg-red-500/20">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="1.5"
                        stroke="currentColor"
                        class="h-6 w-6 fill-red-500 text-gray-50 dark:text-gray-950"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                </div>

                <span class="text-dark ml-3 text-2xl font-bold dark:text-white sm:text-3xl">
                    <?php echo e($exception->title()); ?>

                </span>
            </div>

            <div class="flex items-center gap-3 sm:gap-6">
                <?php if (isset($component)) { $__componentOriginal9b6ddd2809dd60ece07dfaf1f3ef876f = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal9b6ddd2809dd60ece07dfaf1f3ef876f = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.theme-switcher','data' => []] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::theme-switcher'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes([]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal9b6ddd2809dd60ece07dfaf1f3ef876f)): ?>
<?php $attributes = $__attributesOriginal9b6ddd2809dd60ece07dfaf1f3ef876f; ?>
<?php unset($__attributesOriginal9b6ddd2809dd60ece07dfaf1f3ef876f); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal9b6ddd2809dd60ece07dfaf1f3ef876f)): ?>
<?php $component = $__componentOriginal9b6ddd2809dd60ece07dfaf1f3ef876f; ?>
<?php unset($__componentOriginal9b6ddd2809dd60ece07dfaf1f3ef876f); ?>
<?php endif; ?>
            </div>
        </div>
    </div>
</header>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/navigation.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/ac95352bcdc7cb6b645348f21d9bb43e.php

```php
<svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke-width="1.5"
    stroke="currentColor"
    <?php echo e($attributes); ?>

>
    <path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
</svg>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/icons/moon.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/bae129cef9e600352d1c88ca55b5c61c.php

```php
<?php if (isset($component)) { $__componentOriginalbbd4eeea836234825f7514ed20d2d52d = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginalbbd4eeea836234825f7514ed20d2d52d = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.layout','data' => ['exception' => $exception]] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::layout'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['exception' => \Illuminate\View\Compilers\BladeCompiler::sanitizeComponentAttribute($exception)]); ?>
    <div class="renderer container mx-auto lg:px-8">
        <?php if (isset($component)) { $__componentOriginal10cd8b81fdad4ce00a06c99f27003014 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal10cd8b81fdad4ce00a06c99f27003014 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.navigation','data' => ['exception' => $exception]] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::navigation'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['exception' => \Illuminate\View\Compilers\BladeCompiler::sanitizeComponentAttribute($exception)]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal10cd8b81fdad4ce00a06c99f27003014)): ?>
<?php $attributes = $__attributesOriginal10cd8b81fdad4ce00a06c99f27003014; ?>
<?php unset($__attributesOriginal10cd8b81fdad4ce00a06c99f27003014); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal10cd8b81fdad4ce00a06c99f27003014)): ?>
<?php $component = $__componentOriginal10cd8b81fdad4ce00a06c99f27003014; ?>
<?php unset($__componentOriginal10cd8b81fdad4ce00a06c99f27003014); ?>
<?php endif; ?>

        <main class="px-6 pb-12 pt-6">
            <div class="container mx-auto">
                <?php if (isset($component)) { $__componentOriginal1e817eb3c41fe3ea9eb0c15213c4b557 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal1e817eb3c41fe3ea9eb0c15213c4b557 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.header','data' => ['exception' => $exception]] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::header'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['exception' => \Illuminate\View\Compilers\BladeCompiler::sanitizeComponentAttribute($exception)]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal1e817eb3c41fe3ea9eb0c15213c4b557)): ?>
<?php $attributes = $__attributesOriginal1e817eb3c41fe3ea9eb0c15213c4b557; ?>
<?php unset($__attributesOriginal1e817eb3c41fe3ea9eb0c15213c4b557); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal1e817eb3c41fe3ea9eb0c15213c4b557)): ?>
<?php $component = $__componentOriginal1e817eb3c41fe3ea9eb0c15213c4b557; ?>
<?php unset($__componentOriginal1e817eb3c41fe3ea9eb0c15213c4b557); ?>
<?php endif; ?>

                <?php if (isset($component)) { $__componentOriginal1dc7d865c9b6045c4d68faf8bde572ed = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal1dc7d865c9b6045c4d68faf8bde572ed = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.trace-and-editor','data' => ['exception' => $exception]] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::trace-and-editor'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['exception' => \Illuminate\View\Compilers\BladeCompiler::sanitizeComponentAttribute($exception)]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal1dc7d865c9b6045c4d68faf8bde572ed)): ?>
<?php $attributes = $__attributesOriginal1dc7d865c9b6045c4d68faf8bde572ed; ?>
<?php unset($__attributesOriginal1dc7d865c9b6045c4d68faf8bde572ed); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal1dc7d865c9b6045c4d68faf8bde572ed)): ?>
<?php $component = $__componentOriginal1dc7d865c9b6045c4d68faf8bde572ed; ?>
<?php unset($__componentOriginal1dc7d865c9b6045c4d68faf8bde572ed); ?>
<?php endif; ?>

                <?php if (isset($component)) { $__componentOriginal523928ff754f95aea6faf87444393a04 = $component; } ?>
<?php if (isset($attributes)) { $__attributesOriginal523928ff754f95aea6faf87444393a04 = $attributes; } ?>
<?php $component = Illuminate\View\AnonymousComponent::resolve(['view' => 'laravel-exceptions-renderer::components.context','data' => ['exception' => $exception]] + (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag ? $attributes->all() : [])); ?>
<?php $component->withName('laravel-exceptions-renderer::context'); ?>
<?php if ($component->shouldRender()): ?>
<?php $__env->startComponent($component->resolveView(), $component->data()); ?>
<?php if (isset($attributes) && $attributes instanceof Illuminate\View\ComponentAttributeBag): ?>
<?php $attributes = $attributes->except(\Illuminate\View\AnonymousComponent::ignoredParameterNames()); ?>
<?php endif; ?>
<?php $component->withAttributes(['exception' => \Illuminate\View\Compilers\BladeCompiler::sanitizeComponentAttribute($exception)]); ?>
<?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginal523928ff754f95aea6faf87444393a04)): ?>
<?php $attributes = $__attributesOriginal523928ff754f95aea6faf87444393a04; ?>
<?php unset($__attributesOriginal523928ff754f95aea6faf87444393a04); ?>
<?php endif; ?>
<?php if (isset($__componentOriginal523928ff754f95aea6faf87444393a04)): ?>
<?php $component = $__componentOriginal523928ff754f95aea6faf87444393a04; ?>
<?php unset($__componentOriginal523928ff754f95aea6faf87444393a04); ?>
<?php endif; ?>
            </div>
        </main>
    </div>
 <?php echo $__env->renderComponent(); ?>
<?php endif; ?>
<?php if (isset($__attributesOriginalbbd4eeea836234825f7514ed20d2d52d)): ?>
<?php $attributes = $__attributesOriginalbbd4eeea836234825f7514ed20d2d52d; ?>
<?php unset($__attributesOriginalbbd4eeea836234825f7514ed20d2d52d); ?>
<?php endif; ?>
<?php if (isset($__componentOriginalbbd4eeea836234825f7514ed20d2d52d)): ?>
<?php $component = $__componentOriginalbbd4eeea836234825f7514ed20d2d52d; ?>
<?php unset($__componentOriginalbbd4eeea836234825f7514ed20d2d52d); ?>
<?php endif; ?>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/show.blade.php ENDPATH**/ ?>
```

# backend/storage/framework/views/f35c1ee9486679cd0ff0ddd907b0d481.php

```php
<?php $__currentLoopData = $exception->frames(); $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $frame): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); ?>
    <div
        class="sm:col-span-2"
        x-show="index === <?php echo e($loop->index); ?>"
    >
        <div class="mb-3">
            <div class="text-md text-gray-500 dark:text-gray-400">
                <div class="mb-2">

                    <?php if(config('app.editor')): ?>
                        <a href="<?php echo e($frame->editorHref()); ?>" class="text-blue-500 hover:underline">
                            <span class="wrap text-gray-900 dark:text-gray-300"><?php echo e($frame->file()); ?></span>
                        </a>
                    <?php else: ?>
                        <span class="wrap text-gray-900 dark:text-gray-300"><?php echo e($frame->file()); ?></span>
                    <?php endif; ?>

                    <span class="font-mono text-xs">:<?php echo e($frame->line()); ?></span>
                </div>
            </div>
        </div>
        <div class="pt-4 text-sm text-gray-500 dark:text-gray-400">
            <pre class="h-[32.5rem] rounded-md dark:bg-gray-800 border dark:border-gray-700"><template x-if="true"><code
                    style="display: none;"
                    id="frame-<?php echo e($loop->index); ?>"
                    class="language-php highlightable-code <?php if($loop->index === $exception->defaultFrame()): ?> default-highlightable-code <?php endif; ?> scrollbar-hidden overflow-y-hidden"
                    data-line-number="<?php echo e($frame->line()); ?>"
                    data-ln-start-from="<?php echo e(max($frame->line() - 5, 1)); ?>"
                ><?php echo e($frame->snippet()); ?></code></template></pre>
        </div>
    </div>
<?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); ?>
<?php /**PATH /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Providers/../resources/exceptions/renderer/components/editor.blade.php ENDPATH**/ ?>
```

# backend/storage/logs/.gitignore

```
*
!.gitignore

```

# backend/storage/logs/laravel.log

```log
[2024-11-26 16:32:33] local.ERROR: SQLSTATE[42P07]: Duplicate table: 7 ERROR:  relation "categories" already exists (Connection: pgsql, SQL: create table "categories" ("id" bigserial not null primary key, "created_at" timestamp(0) without time zone null, "updated_at" timestamp(0) without time zone null)) {"exception":"[object] (Illuminate\\Database\\QueryException(code: 42P07): SQLSTATE[42P07]: Duplicate table: 7 ERROR:  relation \"categories\" already exists (Connection: pgsql, SQL: create table \"categories\" (\"id\" bigserial not null primary key, \"created_at\" timestamp(0) without time zone null, \"updated_at\" timestamp(0) without time zone null)) at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:825)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('create table \"c...', Array, Object(Closure))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(560): Illuminate\\Database\\Connection->run('create table \"c...', Array, Object(Closure))
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Blueprint.php(117): Illuminate\\Database\\Connection->statement('create table \"c...')
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Builder.php(564): Illuminate\\Database\\Schema\\Blueprint->build(Object(Illuminate\\Database\\PostgresConnection), Object(Illuminate\\Database\\Schema\\Grammars\\PostgresGrammar))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Builder.php(418): Illuminate\\Database\\Schema\\Builder->build(Object(Illuminate\\Database\\Schema\\Blueprint))
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Support/Facades/Facade.php(358): Illuminate\\Database\\Schema\\Builder->create('categories', Object(Closure))
#6 /var/www/html/database/migrations/2024_11_26_163231_create_categories_table.php(14): Illuminate\\Support\\Facades\\Facade::__callStatic('create', Array)
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(476): Illuminate\\Database\\Migrations\\Migration@anonymous->up()
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(401): Illuminate\\Database\\Migrations\\Migrator->runMethod(Object(Illuminate\\Database\\PostgresConnection), Object(Illuminate\\Database\\Migrations\\Migration@anonymous), 'up')
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Concerns/ManagesTransactions.php(32): Illuminate\\Database\\Migrations\\Migrator->Illuminate\\Database\\Migrations\\{closure}(Object(Illuminate\\Database\\PostgresConnection))
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(409): Illuminate\\Database\\Connection->transaction(Object(Closure))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(213): Illuminate\\Database\\Migrations\\Migrator->runMigration(Object(Illuminate\\Database\\Migrations\\Migration@anonymous), 'up')
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/View/Components/Task.php(40): Illuminate\\Database\\Migrations\\Migrator->Illuminate\\Database\\Migrations\\{closure}()
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(737): Illuminate\\Console\\View\\Components\\Task->render('2024_11_26_1632...', Object(Closure))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(213): Illuminate\\Database\\Migrations\\Migrator->write('Illuminate\\\\Cons...', '2024_11_26_1632...', Object(Closure))
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(180): Illuminate\\Database\\Migrations\\Migrator->runUp('/var/www/html/d...', 2, false)
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(123): Illuminate\\Database\\Migrations\\Migrator->runPending(Array, Array)
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(116): Illuminate\\Database\\Migrations\\Migrator->run(Array, Array)
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(616): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->Illuminate\\Database\\Console\\Migrations\\{closure}()
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(109): Illuminate\\Database\\Migrations\\Migrator->usingConnection(NULL, Object(Closure))
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(88): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->runMigrations()
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->handle()
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#27 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#29 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#30 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(Illuminate\\Database\\Console\\Migrations\\MigrateCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#31 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#32 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#33 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#34 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#35 {main}

[previous exception] [object] (PDOException(code: 42P07): SQLSTATE[42P07]: Duplicate table: 7 ERROR:  relation \"categories\" already exists at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:571)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(571): PDOStatement->execute()
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(812): Illuminate\\Database\\Connection->Illuminate\\Database\\{closure}('create table \"c...', Array)
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('create table \"c...', Array, Object(Closure))
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(560): Illuminate\\Database\\Connection->run('create table \"c...', Array, Object(Closure))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Blueprint.php(117): Illuminate\\Database\\Connection->statement('create table \"c...')
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Builder.php(564): Illuminate\\Database\\Schema\\Blueprint->build(Object(Illuminate\\Database\\PostgresConnection), Object(Illuminate\\Database\\Schema\\Grammars\\PostgresGrammar))
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Builder.php(418): Illuminate\\Database\\Schema\\Builder->build(Object(Illuminate\\Database\\Schema\\Blueprint))
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Support/Facades/Facade.php(358): Illuminate\\Database\\Schema\\Builder->create('categories', Object(Closure))
#8 /var/www/html/database/migrations/2024_11_26_163231_create_categories_table.php(14): Illuminate\\Support\\Facades\\Facade::__callStatic('create', Array)
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(476): Illuminate\\Database\\Migrations\\Migration@anonymous->up()
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(401): Illuminate\\Database\\Migrations\\Migrator->runMethod(Object(Illuminate\\Database\\PostgresConnection), Object(Illuminate\\Database\\Migrations\\Migration@anonymous), 'up')
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Concerns/ManagesTransactions.php(32): Illuminate\\Database\\Migrations\\Migrator->Illuminate\\Database\\Migrations\\{closure}(Object(Illuminate\\Database\\PostgresConnection))
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(409): Illuminate\\Database\\Connection->transaction(Object(Closure))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(213): Illuminate\\Database\\Migrations\\Migrator->runMigration(Object(Illuminate\\Database\\Migrations\\Migration@anonymous), 'up')
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/View/Components/Task.php(40): Illuminate\\Database\\Migrations\\Migrator->Illuminate\\Database\\Migrations\\{closure}()
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(737): Illuminate\\Console\\View\\Components\\Task->render('2024_11_26_1632...', Object(Closure))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(213): Illuminate\\Database\\Migrations\\Migrator->write('Illuminate\\\\Cons...', '2024_11_26_1632...', Object(Closure))
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(180): Illuminate\\Database\\Migrations\\Migrator->runUp('/var/www/html/d...', 2, false)
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(123): Illuminate\\Database\\Migrations\\Migrator->runPending(Array, Array)
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(116): Illuminate\\Database\\Migrations\\Migrator->run(Array, Array)
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(616): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->Illuminate\\Database\\Console\\Migrations\\{closure}()
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(109): Illuminate\\Database\\Migrations\\Migrator->usingConnection(NULL, Object(Closure))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(88): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->runMigrations()
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->handle()
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#27 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#29 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#30 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#31 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#32 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(Illuminate\\Database\\Console\\Migrations\\MigrateCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#33 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#34 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#35 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#36 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#37 {main}
"} 
[2024-11-26 16:32:34] local.ERROR: SQLSTATE[42P07]: Duplicate table: 7 ERROR:  relation "categories" already exists (Connection: pgsql, SQL: create table "categories" ("id" bigserial not null primary key, "created_at" timestamp(0) without time zone null, "updated_at" timestamp(0) without time zone null)) {"exception":"[object] (Illuminate\\Database\\QueryException(code: 42P07): SQLSTATE[42P07]: Duplicate table: 7 ERROR:  relation \"categories\" already exists (Connection: pgsql, SQL: create table \"categories\" (\"id\" bigserial not null primary key, \"created_at\" timestamp(0) without time zone null, \"updated_at\" timestamp(0) without time zone null)) at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:825)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('create table \"c...', Array, Object(Closure))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(560): Illuminate\\Database\\Connection->run('create table \"c...', Array, Object(Closure))
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Blueprint.php(117): Illuminate\\Database\\Connection->statement('create table \"c...')
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Builder.php(564): Illuminate\\Database\\Schema\\Blueprint->build(Object(Illuminate\\Database\\PostgresConnection), Object(Illuminate\\Database\\Schema\\Grammars\\PostgresGrammar))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Builder.php(418): Illuminate\\Database\\Schema\\Builder->build(Object(Illuminate\\Database\\Schema\\Blueprint))
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Support/Facades/Facade.php(358): Illuminate\\Database\\Schema\\Builder->create('categories', Object(Closure))
#6 /var/www/html/database/migrations/2024_11_26_163231_create_categories_table.php(14): Illuminate\\Support\\Facades\\Facade::__callStatic('create', Array)
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(476): Illuminate\\Database\\Migrations\\Migration@anonymous->up()
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(401): Illuminate\\Database\\Migrations\\Migrator->runMethod(Object(Illuminate\\Database\\PostgresConnection), Object(Illuminate\\Database\\Migrations\\Migration@anonymous), 'up')
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Concerns/ManagesTransactions.php(32): Illuminate\\Database\\Migrations\\Migrator->Illuminate\\Database\\Migrations\\{closure}(Object(Illuminate\\Database\\PostgresConnection))
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(409): Illuminate\\Database\\Connection->transaction(Object(Closure))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(213): Illuminate\\Database\\Migrations\\Migrator->runMigration(Object(Illuminate\\Database\\Migrations\\Migration@anonymous), 'up')
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/View/Components/Task.php(40): Illuminate\\Database\\Migrations\\Migrator->Illuminate\\Database\\Migrations\\{closure}()
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(737): Illuminate\\Console\\View\\Components\\Task->render('2024_11_26_1632...', Object(Closure))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(213): Illuminate\\Database\\Migrations\\Migrator->write('Illuminate\\\\Cons...', '2024_11_26_1632...', Object(Closure))
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(180): Illuminate\\Database\\Migrations\\Migrator->runUp('/var/www/html/d...', 1, false)
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(123): Illuminate\\Database\\Migrations\\Migrator->runPending(Array, Array)
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(116): Illuminate\\Database\\Migrations\\Migrator->run(Array, Array)
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(616): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->Illuminate\\Database\\Console\\Migrations\\{closure}()
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(109): Illuminate\\Database\\Migrations\\Migrator->usingConnection(NULL, Object(Closure))
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(88): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->runMigrations()
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->handle()
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#27 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArrayInput), Object(Illuminate\\Console\\OutputStyle))
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArrayInput), Object(Illuminate\\Console\\OutputStyle))
#29 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Concerns/CallsCommands.php(67): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArrayInput), Object(Illuminate\\Console\\OutputStyle))
#30 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Concerns/CallsCommands.php(28): Illuminate\\Console\\Command->runCommand('migrate', Array, Object(Illuminate\\Console\\OutputStyle))
#31 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/FreshCommand.php(82): Illuminate\\Console\\Command->call('migrate', Array)
#32 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Database\\Console\\Migrations\\FreshCommand->handle()
#33 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#34 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#35 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#36 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#37 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#38 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#39 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#40 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#41 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(Illuminate\\Database\\Console\\Migrations\\FreshCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#42 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#43 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#44 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#45 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#46 {main}

[previous exception] [object] (PDOException(code: 42P07): SQLSTATE[42P07]: Duplicate table: 7 ERROR:  relation \"categories\" already exists at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:571)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(571): PDOStatement->execute()
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(812): Illuminate\\Database\\Connection->Illuminate\\Database\\{closure}('create table \"c...', Array)
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('create table \"c...', Array, Object(Closure))
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(560): Illuminate\\Database\\Connection->run('create table \"c...', Array, Object(Closure))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Blueprint.php(117): Illuminate\\Database\\Connection->statement('create table \"c...')
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Builder.php(564): Illuminate\\Database\\Schema\\Blueprint->build(Object(Illuminate\\Database\\PostgresConnection), Object(Illuminate\\Database\\Schema\\Grammars\\PostgresGrammar))
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Schema/Builder.php(418): Illuminate\\Database\\Schema\\Builder->build(Object(Illuminate\\Database\\Schema\\Blueprint))
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Support/Facades/Facade.php(358): Illuminate\\Database\\Schema\\Builder->create('categories', Object(Closure))
#8 /var/www/html/database/migrations/2024_11_26_163231_create_categories_table.php(14): Illuminate\\Support\\Facades\\Facade::__callStatic('create', Array)
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(476): Illuminate\\Database\\Migrations\\Migration@anonymous->up()
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(401): Illuminate\\Database\\Migrations\\Migrator->runMethod(Object(Illuminate\\Database\\PostgresConnection), Object(Illuminate\\Database\\Migrations\\Migration@anonymous), 'up')
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Concerns/ManagesTransactions.php(32): Illuminate\\Database\\Migrations\\Migrator->Illuminate\\Database\\Migrations\\{closure}(Object(Illuminate\\Database\\PostgresConnection))
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(409): Illuminate\\Database\\Connection->transaction(Object(Closure))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(213): Illuminate\\Database\\Migrations\\Migrator->runMigration(Object(Illuminate\\Database\\Migrations\\Migration@anonymous), 'up')
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/View/Components/Task.php(40): Illuminate\\Database\\Migrations\\Migrator->Illuminate\\Database\\Migrations\\{closure}()
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(737): Illuminate\\Console\\View\\Components\\Task->render('2024_11_26_1632...', Object(Closure))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(213): Illuminate\\Database\\Migrations\\Migrator->write('Illuminate\\\\Cons...', '2024_11_26_1632...', Object(Closure))
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(180): Illuminate\\Database\\Migrations\\Migrator->runUp('/var/www/html/d...', 1, false)
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(123): Illuminate\\Database\\Migrations\\Migrator->runPending(Array, Array)
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(116): Illuminate\\Database\\Migrations\\Migrator->run(Array, Array)
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Migrations/Migrator.php(616): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->Illuminate\\Database\\Console\\Migrations\\{closure}()
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(109): Illuminate\\Database\\Migrations\\Migrator->usingConnection(NULL, Object(Closure))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/MigrateCommand.php(88): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->runMigrations()
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Database\\Console\\Migrations\\MigrateCommand->handle()
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#27 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#29 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArrayInput), Object(Illuminate\\Console\\OutputStyle))
#30 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArrayInput), Object(Illuminate\\Console\\OutputStyle))
#31 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Concerns/CallsCommands.php(67): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArrayInput), Object(Illuminate\\Console\\OutputStyle))
#32 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Concerns/CallsCommands.php(28): Illuminate\\Console\\Command->runCommand('migrate', Array, Object(Illuminate\\Console\\OutputStyle))
#33 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Console/Migrations/FreshCommand.php(82): Illuminate\\Console\\Command->call('migrate', Array)
#34 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Database\\Console\\Migrations\\FreshCommand->handle()
#35 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#36 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#37 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#38 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#39 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#40 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#41 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#42 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#43 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(Illuminate\\Database\\Console\\Migrations\\FreshCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#44 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#45 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#46 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#47 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#48 {main}
"} 
[2024-11-27 01:48:37] local.ERROR: SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation "cache" does not exist
LINE 1: delete from "cache"
                    ^ (Connection: pgsql, SQL: delete from "cache") {"exception":"[object] (Illuminate\\Database\\QueryException(code: 42P01): SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation \"cache\" does not exist
LINE 1: delete from \"cache\"
                    ^ (Connection: pgsql, SQL: delete from \"cache\") at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:825)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('delete from \"ca...', Array, Object(Closure))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(584): Illuminate\\Database\\Connection->run('delete from \"ca...', Array, Object(Closure))
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(548): Illuminate\\Database\\Connection->affectingStatement('delete from \"ca...', Array)
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(4066): Illuminate\\Database\\Connection->delete('delete from \"ca...', Array)
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/DatabaseStore.php(421): Illuminate\\Database\\Query\\Builder->delete()
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/Repository.php(791): Illuminate\\Cache\\DatabaseStore->flush()
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/Console/ClearCommand.php(69): Illuminate\\Cache\\Repository->__call('flush', Array)
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Cache\\Console\\ClearCommand->handle()
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#13 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#15 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#16 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(Illuminate\\Cache\\Console\\ClearCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#17 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#20 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#21 {main}

[previous exception] [object] (PDOException(code: 42P01): SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation \"cache\" does not exist
LINE 1: delete from \"cache\"
                    ^ at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:596)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(596): PDOStatement->execute()
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(812): Illuminate\\Database\\Connection->Illuminate\\Database\\{closure}('delete from \"ca...', Array)
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('delete from \"ca...', Array, Object(Closure))
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(584): Illuminate\\Database\\Connection->run('delete from \"ca...', Array, Object(Closure))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(548): Illuminate\\Database\\Connection->affectingStatement('delete from \"ca...', Array)
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(4066): Illuminate\\Database\\Connection->delete('delete from \"ca...', Array)
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/DatabaseStore.php(421): Illuminate\\Database\\Query\\Builder->delete()
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/Repository.php(791): Illuminate\\Cache\\DatabaseStore->flush()
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/Console/ClearCommand.php(69): Illuminate\\Cache\\Repository->__call('flush', Array)
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Cache\\Console\\ClearCommand->handle()
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#15 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#17 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#18 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(Illuminate\\Cache\\Console\\ClearCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#19 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#22 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#23 {main}
"} 
[2024-11-27 01:48:51] local.ERROR: SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation "cache" does not exist
LINE 1: delete from "cache"
                    ^ (Connection: pgsql, SQL: delete from "cache") {"exception":"[object] (Illuminate\\Database\\QueryException(code: 42P01): SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation \"cache\" does not exist
LINE 1: delete from \"cache\"
                    ^ (Connection: pgsql, SQL: delete from \"cache\") at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:825)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('delete from \"ca...', Array, Object(Closure))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(584): Illuminate\\Database\\Connection->run('delete from \"ca...', Array, Object(Closure))
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(548): Illuminate\\Database\\Connection->affectingStatement('delete from \"ca...', Array)
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(4066): Illuminate\\Database\\Connection->delete('delete from \"ca...', Array)
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/DatabaseStore.php(421): Illuminate\\Database\\Query\\Builder->delete()
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/Repository.php(791): Illuminate\\Cache\\DatabaseStore->flush()
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/Console/ClearCommand.php(69): Illuminate\\Cache\\Repository->__call('flush', Array)
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Cache\\Console\\ClearCommand->handle()
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#13 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#15 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#16 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(Illuminate\\Cache\\Console\\ClearCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#17 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#20 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#21 {main}

[previous exception] [object] (PDOException(code: 42P01): SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation \"cache\" does not exist
LINE 1: delete from \"cache\"
                    ^ at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:596)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(596): PDOStatement->execute()
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(812): Illuminate\\Database\\Connection->Illuminate\\Database\\{closure}('delete from \"ca...', Array)
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('delete from \"ca...', Array, Object(Closure))
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(584): Illuminate\\Database\\Connection->run('delete from \"ca...', Array, Object(Closure))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(548): Illuminate\\Database\\Connection->affectingStatement('delete from \"ca...', Array)
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(4066): Illuminate\\Database\\Connection->delete('delete from \"ca...', Array)
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/DatabaseStore.php(421): Illuminate\\Database\\Query\\Builder->delete()
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/Repository.php(791): Illuminate\\Cache\\DatabaseStore->flush()
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Cache/Console/ClearCommand.php(69): Illuminate\\Cache\\Repository->__call('flush', Array)
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): Illuminate\\Cache\\Console\\ClearCommand->handle()
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#15 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#17 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#18 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(Illuminate\\Cache\\Console\\ClearCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#19 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#22 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#23 {main}
"} 
[2024-11-27 01:59:18] local.ERROR: Class "App\Console\Commands\Article" not found {"exception":"[object] (Error(code: 0): Class \"App\\Console\\Commands\\Article\" not found at /var/www/html/app/Console/Commands/FetchNewsCommand.php:19)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): App\\Console\\Commands\\FetchNewsCommand->handle(Object(App\\Services\\NewsService))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#6 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#8 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#9 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(App\\Console\\Commands\\FetchNewsCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#10 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#13 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#14 {main}
"} 
[2024-11-27 09:45:29] local.ERROR: NewsAPI fetch failed: SQLSTATE[42703]: Undefined column: 7 ERROR:  column "api_id" does not exist
LINE 1: select * from "sources" where ("api_id" is null) limit 1
                                       ^ (Connection: pgsql, SQL: select * from "sources" where ("api_id" is null) limit 1)  
[2024-11-27 09:45:32] local.ERROR: Guardian fetch failed: SQLSTATE[42703]: Undefined column: 7 ERROR:  column "api_id" does not exist
LINE 1: select * from "sources" where ("api_id" = $1) limit 1
                                       ^ (Connection: pgsql, SQL: select * from "sources" where ("api_id" = guardian) limit 1)  
[2024-11-27 09:45:33] local.ERROR: NY Times fetch failed: SQLSTATE[42703]: Undefined column: 7 ERROR:  column "api_id" does not exist
LINE 1: select * from "sources" where ("api_id" = $1) limit 1
                                       ^ (Connection: pgsql, SQL: select * from "sources" where ("api_id" = nytimes) limit 1)  
[2024-11-27 09:45:45] local.ERROR: Call to undefined method App\Http\Controllers\Api\ArticleController::info() {"exception":"[object] (Error(code: 0): Call to undefined method App\\Http\\Controllers\\Api\\ArticleController::info() at /var/www/html/app/Http/Controllers/Api/ArticleController.php:18)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/ControllerDispatcher.php(46): App\\Http\\Controllers\\Api\\ArticleController->index(Object(Illuminate\\Http\\Request))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(265): Illuminate\\Routing\\ControllerDispatcher->dispatch(Object(Illuminate\\Routing\\Route), Object(App\\Http\\Controllers\\Api\\ArticleController), 'index')
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(211): Illuminate\\Routing\\Route->runController()
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(808): Illuminate\\Routing\\Route->run()
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Routing\\Router->Illuminate\\Routing\\{closure}(Object(Illuminate\\Http\\Request))
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Middleware/SubstituteBindings.php(51): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Routing\\Middleware\\SubstituteBindings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(807): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(786): Illuminate\\Routing\\Router->runRouteWithinStack(Object(Illuminate\\Routing\\Route), Object(Illuminate\\Http\\Request))
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(750): Illuminate\\Routing\\Router->runRoute(Object(Illuminate\\Http\\Request), Object(Illuminate\\Routing\\Route))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(739): Illuminate\\Routing\\Router->dispatchToRoute(Object(Illuminate\\Http\\Request))
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(201): Illuminate\\Routing\\Router->dispatch(Object(Illuminate\\Http\\Request))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Foundation\\Http\\Kernel->Illuminate\\Foundation\\Http\\{closure}(Object(Illuminate\\Http\\Request))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/ConvertEmptyStringsToNull.php(31): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\ConvertEmptyStringsToNull->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TrimStrings.php(51): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\TrimStrings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/ValidatePostSize.php(27): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\ValidatePostSize->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/PreventRequestsDuringMaintenance.php(110): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\PreventRequestsDuringMaintenance->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/HandleCors.php(62): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\HandleCors->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/TrustProxies.php(58): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#27 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\TrustProxies->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/InvokeDeferredCallbacks.php(22): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#29 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\InvokeDeferredCallbacks->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#30 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#31 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(176): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#32 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(145): Illuminate\\Foundation\\Http\\Kernel->sendRequestThroughRouter(Object(Illuminate\\Http\\Request))
#33 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1190): Illuminate\\Foundation\\Http\\Kernel->handle(Object(Illuminate\\Http\\Request))
#34 /var/www/html/public/index.php(17): Illuminate\\Foundation\\Application->handleRequest(Object(Illuminate\\Http\\Request))
#35 {main}
"} 
[2024-11-27 09:45:48] local.ERROR: Call to undefined method App\Http\Controllers\Api\ArticleController::info() {"exception":"[object] (Error(code: 0): Call to undefined method App\\Http\\Controllers\\Api\\ArticleController::info() at /var/www/html/app/Http/Controllers/Api/ArticleController.php:18)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/ControllerDispatcher.php(46): App\\Http\\Controllers\\Api\\ArticleController->index(Object(Illuminate\\Http\\Request))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(265): Illuminate\\Routing\\ControllerDispatcher->dispatch(Object(Illuminate\\Routing\\Route), Object(App\\Http\\Controllers\\Api\\ArticleController), 'index')
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(211): Illuminate\\Routing\\Route->runController()
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(808): Illuminate\\Routing\\Route->run()
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Routing\\Router->Illuminate\\Routing\\{closure}(Object(Illuminate\\Http\\Request))
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Middleware/SubstituteBindings.php(51): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Routing\\Middleware\\SubstituteBindings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(807): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(786): Illuminate\\Routing\\Router->runRouteWithinStack(Object(Illuminate\\Routing\\Route), Object(Illuminate\\Http\\Request))
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(750): Illuminate\\Routing\\Router->runRoute(Object(Illuminate\\Http\\Request), Object(Illuminate\\Routing\\Route))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(739): Illuminate\\Routing\\Router->dispatchToRoute(Object(Illuminate\\Http\\Request))
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(201): Illuminate\\Routing\\Router->dispatch(Object(Illuminate\\Http\\Request))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Foundation\\Http\\Kernel->Illuminate\\Foundation\\Http\\{closure}(Object(Illuminate\\Http\\Request))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/ConvertEmptyStringsToNull.php(31): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\ConvertEmptyStringsToNull->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TrimStrings.php(51): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\TrimStrings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/ValidatePostSize.php(27): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\ValidatePostSize->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/PreventRequestsDuringMaintenance.php(110): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\PreventRequestsDuringMaintenance->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/HandleCors.php(62): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\HandleCors->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/TrustProxies.php(58): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#27 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\TrustProxies->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/InvokeDeferredCallbacks.php(22): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#29 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\InvokeDeferredCallbacks->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#30 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#31 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(176): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#32 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(145): Illuminate\\Foundation\\Http\\Kernel->sendRequestThroughRouter(Object(Illuminate\\Http\\Request))
#33 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1190): Illuminate\\Foundation\\Http\\Kernel->handle(Object(Illuminate\\Http\\Request))
#34 /var/www/html/public/index.php(17): Illuminate\\Foundation\\Application->handleRequest(Object(Illuminate\\Http\\Request))
#35 {main}
"} 
[2024-11-27 09:48:15] local.ERROR: Call to undefined method App\Http\Controllers\Api\ArticleController::info() {"exception":"[object] (Error(code: 0): Call to undefined method App\\Http\\Controllers\\Api\\ArticleController::info() at /var/www/html/app/Http/Controllers/Api/ArticleController.php:18)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/ControllerDispatcher.php(46): App\\Http\\Controllers\\Api\\ArticleController->index(Object(Illuminate\\Http\\Request))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(265): Illuminate\\Routing\\ControllerDispatcher->dispatch(Object(Illuminate\\Routing\\Route), Object(App\\Http\\Controllers\\Api\\ArticleController), 'index')
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(211): Illuminate\\Routing\\Route->runController()
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(808): Illuminate\\Routing\\Route->run()
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Routing\\Router->Illuminate\\Routing\\{closure}(Object(Illuminate\\Http\\Request))
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Middleware/SubstituteBindings.php(51): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Routing\\Middleware\\SubstituteBindings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(807): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(786): Illuminate\\Routing\\Router->runRouteWithinStack(Object(Illuminate\\Routing\\Route), Object(Illuminate\\Http\\Request))
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(750): Illuminate\\Routing\\Router->runRoute(Object(Illuminate\\Http\\Request), Object(Illuminate\\Routing\\Route))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(739): Illuminate\\Routing\\Router->dispatchToRoute(Object(Illuminate\\Http\\Request))
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(201): Illuminate\\Routing\\Router->dispatch(Object(Illuminate\\Http\\Request))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Foundation\\Http\\Kernel->Illuminate\\Foundation\\Http\\{closure}(Object(Illuminate\\Http\\Request))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/ConvertEmptyStringsToNull.php(31): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\ConvertEmptyStringsToNull->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TrimStrings.php(51): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\TrimStrings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/ValidatePostSize.php(27): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\ValidatePostSize->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/PreventRequestsDuringMaintenance.php(110): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\PreventRequestsDuringMaintenance->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/HandleCors.php(62): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\HandleCors->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/TrustProxies.php(58): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#27 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\TrustProxies->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/InvokeDeferredCallbacks.php(22): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#29 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\InvokeDeferredCallbacks->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#30 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#31 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(176): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#32 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(145): Illuminate\\Foundation\\Http\\Kernel->sendRequestThroughRouter(Object(Illuminate\\Http\\Request))
#33 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1190): Illuminate\\Foundation\\Http\\Kernel->handle(Object(Illuminate\\Http\\Request))
#34 /var/www/html/public/index.php(17): Illuminate\\Foundation\\Application->handleRequest(Object(Illuminate\\Http\\Request))
#35 {main}
"} 
[2024-11-27 09:49:58] local.ERROR: SQLSTATE[42703]: Undefined column: 7 ERROR:  column "published_at" does not exist
LINE 1: select * from "articles" order by "published_at" desc limit ...
                                          ^ (Connection: pgsql, SQL: select * from "articles" order by "published_at" desc limit 1) {"exception":"[object] (Illuminate\\Database\\QueryException(code: 42703): SQLSTATE[42703]: Undefined column: 7 ERROR:  column \"published_at\" does not exist
LINE 1: select * from \"articles\" order by \"published_at\" desc limit ...
                                          ^ (Connection: pgsql, SQL: select * from \"articles\" order by \"published_at\" desc limit 1) at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:825)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('select * from \"...', Array, Object(Closure))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(398): Illuminate\\Database\\Connection->run('select * from \"...', Array, Object(Closure))
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3133): Illuminate\\Database\\Connection->select('select * from \"...', Array, true)
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3118): Illuminate\\Database\\Query\\Builder->runSelect()
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3706): Illuminate\\Database\\Query\\Builder->Illuminate\\Database\\Query\\{closure}()
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3117): Illuminate\\Database\\Query\\Builder->onceWithColumns(Array, Object(Closure))
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(759): Illuminate\\Database\\Query\\Builder->get(Array)
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(741): Illuminate\\Database\\Eloquent\\Builder->getModels(Array)
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Concerns/BuildsQueries.php(344): Illuminate\\Database\\Eloquent\\Builder->get(Array)
#9 /var/www/html/app/Console/Commands/NewsStatusCommand.php(27): Illuminate\\Database\\Eloquent\\Builder->first()
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): App\\Console\\Commands\\NewsStatusCommand->handle()
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#16 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#18 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#19 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(App\\Console\\Commands\\NewsStatusCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#20 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#23 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#24 {main}

[previous exception] [object] (PDOException(code: 42703): SQLSTATE[42703]: Undefined column: 7 ERROR:  column \"published_at\" does not exist
LINE 1: select * from \"articles\" order by \"published_at\" desc limit ...
                                          ^ at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:412)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(412): PDOStatement->execute()
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(812): Illuminate\\Database\\Connection->Illuminate\\Database\\{closure}('select * from \"...', Array)
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('select * from \"...', Array, Object(Closure))
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(398): Illuminate\\Database\\Connection->run('select * from \"...', Array, Object(Closure))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3133): Illuminate\\Database\\Connection->select('select * from \"...', Array, true)
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3118): Illuminate\\Database\\Query\\Builder->runSelect()
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3706): Illuminate\\Database\\Query\\Builder->Illuminate\\Database\\Query\\{closure}()
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3117): Illuminate\\Database\\Query\\Builder->onceWithColumns(Array, Object(Closure))
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(759): Illuminate\\Database\\Query\\Builder->get(Array)
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(741): Illuminate\\Database\\Eloquent\\Builder->getModels(Array)
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Concerns/BuildsQueries.php(344): Illuminate\\Database\\Eloquent\\Builder->get(Array)
#11 /var/www/html/app/Console/Commands/NewsStatusCommand.php(27): Illuminate\\Database\\Eloquent\\Builder->first()
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): App\\Console\\Commands\\NewsStatusCommand->handle()
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#18 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#20 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#21 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(App\\Console\\Commands\\NewsStatusCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#22 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#25 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#26 {main}
"} 
[2024-11-27 09:50:31] local.ERROR: SQLSTATE[42703]: Undefined column: 7 ERROR:  column "published_at" does not exist
LINE 1: select * from "articles" order by "published_at" desc limit ...
                                          ^ (Connection: pgsql, SQL: select * from "articles" order by "published_at" desc limit 1) {"exception":"[object] (Illuminate\\Database\\QueryException(code: 42703): SQLSTATE[42703]: Undefined column: 7 ERROR:  column \"published_at\" does not exist
LINE 1: select * from \"articles\" order by \"published_at\" desc limit ...
                                          ^ (Connection: pgsql, SQL: select * from \"articles\" order by \"published_at\" desc limit 1) at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:825)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('select * from \"...', Array, Object(Closure))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(398): Illuminate\\Database\\Connection->run('select * from \"...', Array, Object(Closure))
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3133): Illuminate\\Database\\Connection->select('select * from \"...', Array, true)
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3118): Illuminate\\Database\\Query\\Builder->runSelect()
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3706): Illuminate\\Database\\Query\\Builder->Illuminate\\Database\\Query\\{closure}()
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3117): Illuminate\\Database\\Query\\Builder->onceWithColumns(Array, Object(Closure))
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(759): Illuminate\\Database\\Query\\Builder->get(Array)
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(741): Illuminate\\Database\\Eloquent\\Builder->getModels(Array)
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Concerns/BuildsQueries.php(344): Illuminate\\Database\\Eloquent\\Builder->get(Array)
#9 /var/www/html/app/Console/Commands/NewsStatusCommand.php(27): Illuminate\\Database\\Eloquent\\Builder->first()
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): App\\Console\\Commands\\NewsStatusCommand->handle()
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#16 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#18 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#19 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(App\\Console\\Commands\\NewsStatusCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#20 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#23 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#24 {main}

[previous exception] [object] (PDOException(code: 42703): SQLSTATE[42703]: Undefined column: 7 ERROR:  column \"published_at\" does not exist
LINE 1: select * from \"articles\" order by \"published_at\" desc limit ...
                                          ^ at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:412)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(412): PDOStatement->execute()
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(812): Illuminate\\Database\\Connection->Illuminate\\Database\\{closure}('select * from \"...', Array)
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('select * from \"...', Array, Object(Closure))
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(398): Illuminate\\Database\\Connection->run('select * from \"...', Array, Object(Closure))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3133): Illuminate\\Database\\Connection->select('select * from \"...', Array, true)
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3118): Illuminate\\Database\\Query\\Builder->runSelect()
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3706): Illuminate\\Database\\Query\\Builder->Illuminate\\Database\\Query\\{closure}()
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3117): Illuminate\\Database\\Query\\Builder->onceWithColumns(Array, Object(Closure))
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(759): Illuminate\\Database\\Query\\Builder->get(Array)
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(741): Illuminate\\Database\\Eloquent\\Builder->getModels(Array)
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Concerns/BuildsQueries.php(344): Illuminate\\Database\\Eloquent\\Builder->get(Array)
#11 /var/www/html/app/Console/Commands/NewsStatusCommand.php(27): Illuminate\\Database\\Eloquent\\Builder->first()
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(36): App\\Console\\Commands\\NewsStatusCommand->handle()
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Util.php(43): Illuminate\\Container\\BoundMethod::Illuminate\\Container\\{closure}()
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(95): Illuminate\\Container\\Util::unwrapIfClosure(Object(Closure))
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/BoundMethod.php(35): Illuminate\\Container\\BoundMethod::callBoundMethod(Object(Illuminate\\Foundation\\Application), Array, Object(Closure))
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Container/Container.php(694): Illuminate\\Container\\BoundMethod::call(Object(Illuminate\\Foundation\\Application), Array, Array, NULL)
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(213): Illuminate\\Container\\Container->call(Array)
#18 /var/www/html/vendor/symfony/console/Command/Command.php(279): Illuminate\\Console\\Command->execute(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Console/Command.php(182): Symfony\\Component\\Console\\Command\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Illuminate\\Console\\OutputStyle))
#20 /var/www/html/vendor/symfony/console/Application.php(1047): Illuminate\\Console\\Command->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#21 /var/www/html/vendor/symfony/console/Application.php(316): Symfony\\Component\\Console\\Application->doRunCommand(Object(App\\Console\\Commands\\NewsStatusCommand), Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#22 /var/www/html/vendor/symfony/console/Application.php(167): Symfony\\Component\\Console\\Application->doRun(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Console/Kernel.php(197): Symfony\\Component\\Console\\Application->run(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1205): Illuminate\\Foundation\\Console\\Kernel->handle(Object(Symfony\\Component\\Console\\Input\\ArgvInput), Object(Symfony\\Component\\Console\\Output\\ConsoleOutput))
#25 /var/www/html/artisan(13): Illuminate\\Foundation\\Application->handleCommand(Object(Symfony\\Component\\Console\\Input\\ArgvInput))
#26 {main}
"} 
[2024-11-27 09:51:56] local.ERROR: NewsAPI fetch failed: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 09:51:58] local.ERROR: Guardian fetch failed: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 09:52:00] local.ERROR: NY Times fetch failed: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 09:54:59] local.ERROR: NewsAPI fetch failed: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 09:55:02] local.ERROR: Guardian fetch failed: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 09:55:03] local.ERROR: NY Times fetch failed: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: SQLSTATE[22001]: String data, right truncated: 7 ERROR:  value too long for type character varying(255) (Connection: pgsql, SQL: insert into "articles" ("api_id", "source_id", "title", "description", "content", "author", "url", "image_url", "published_at", "api_source", "updated_at", "created_at") values (9648d54c6067a1ae8beb1f67fe259961, 19, Charlotte Douglas airport workers vote to strike - WSOC Charlotte, Overnight Monday, Charlotte Douglas International Airport workers voted to go on strike over what they’re calling unfair labor practices and poverty wages., CHARLOTTE — Overnight Monday, Charlotte Douglas International Airport workers voted to go on strike over what theyre calling unfair labor practices and poverty wages.
Service workers including cabin… [+1974 chars], WSOCTV.com News Staff, https://www.wsoctv.com/news/local/charlotte-douglas-airport-workers-vote-strike/6B26WIYVSBB2DPWGAMEX4HCISM/, https://cmg-cmg-tv-10030-prod.cdn.arcpublishing.com/resizer/v2/https%3A%2F%2Fcloudfront-us-east-1.images.arcpublishing.com%2Fcmg%2FRLP5ETLWIJHDVPDPC7XM5DB3HY.jpeg?auth=4942aa48b5e4d8be4f02f679b4872c073f938ddb9a6bf92a9b2ba29da228afe4&width=1200&height=630&smart=true, 2024-11-25 17:30:05, newsapi, 2024-11-27 10:02:01, 2024-11-27 10:02:01) returning "id")  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:01] local.INFO: NewsAPI: Processed 0 articles, skipped 31  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:03] local.INFO: NewsAPI: Processed 0 articles, skipped 67  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:05] local.INFO: NewsAPI: Processed 0 articles, skipped 56  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: SQLSTATE[22001]: String data, right truncated: 7 ERROR:  value too long for type character varying(255) (Connection: pgsql, SQL: insert into "articles" ("api_id", "source_id", "title", "description", "content", "author", "url", "image_url", "published_at", "api_source", "updated_at", "created_at") values (bb5aaa0eeeaea940a3b507ee43335319, 108, Research Reveals Long COVID Hits the Young Harder Than the Old - Newsmax, ?, ?, Newsmax, https://news.google.com/rss/articles/CBMiigFBVV95cUxOeXJFRE9jTExZOHpMVkozdDd4U1hvZ050QWFTT19DZFp0N0dZc3ZPV0h0RFZ6bFhPQzY4MzhROXd2ZnRQMy02NGJYcTVEUkZzMjVNbmtVNFNVeGxMTG5mVmcxUkMwRkZhWHc2TG9fRUpsa0h5YXlSRFJCQmNXOVJXd3VqczVXMVZsTGfSAY8BQVVfeXFMT3lnMzZYR3BydllXckNXbnVOTW01czl2bk9SN21JVFQzck5fWlBSRlR4ZnM1NFVmZWVrbnF2Njh0NHFJVFVzZDZ1Y0l5bjNPZUdhWm5yNndvUlptSEF6Q2Zyc3ZKSVBYZnZmTzJRUXoxekxGYkFwS1A2a01nSnJVamt1c3R3SVlKdFBKMExPeTg?oc=5, ?, 2024-11-25 13:58:00, newsapi, 2024-11-27 10:02:07, 2024-11-27 10:02:07) returning "id")  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:07] local.INFO: NewsAPI: Processed 0 articles, skipped 69  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: SQLSTATE[22001]: String data, right truncated: 7 ERROR:  value too long for type character varying(255) (Connection: pgsql, SQL: insert into "articles" ("api_id", "source_id", "title", "description", "content", "author", "url", "image_url", "published_at", "api_source", "updated_at", "created_at") values (0bd09c4c4f7c7cf512ba0b937a7164a6, 108, Bears vs. Vikings Game Balls: Caleb Shines Again, Set The Flus Loose - Windy City Gridiron, ?, ?, Windy City Gridiron, https://news.google.com/rss/articles/CBMiuwFBVV95cUxQdmU4Y3d6RUc4NXB4X0pIeEZ6ZzBVRTR3MHJ0cE1zMUxhQ0ZyUXBXSEozQ1pmOXBIRmNiYXhadHVLTTB1elJLN0hRcWtJSWVXUFhUbFlLMWptbTN6c2ZJLW4yQVg4SWp0eDV2MjZ2RFRaMVpTMlFERWh2eHc4M0pwNjJRQkI2TmdrbmtpWGxBU0hzUHRxbXE2LXcySnE1UlBtZDdjOUN2MDNJbHFscXMwVGtkLWJFa283ay0w?oc=5, ?, 2024-11-26 01:30:00, newsapi, 2024-11-27 10:02:08, 2024-11-27 10:02:08) returning "id")  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: SQLSTATE[22001]: String data, right truncated: 7 ERROR:  value too long for type character varying(255) (Connection: pgsql, SQL: insert into "articles" ("api_id", "source_id", "title", "description", "content", "author", "url", "image_url", "published_at", "api_source", "updated_at", "created_at") values (f97254ac402e71679d9082c28ace1c90, 124, Kevin O’Connell praises Daniel Jones but declines to say whether Vikings have interest - NBC Sports, Vikings coach Kevin O'Connell revived the career of one quarterback who flamed out in New York., Vikings coach Kevin OConnell revived the career of one quarterback who flamed out in New York. Might he do it with another?
Daniel Jones, who was cut by the Giants on Saturday, became a free agent M… [+1434 chars], Charean Williams, https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/kevin-oconnell-praises-daniel-jones-but-declines-to-say-whether-vikings-have-interest, https://nbcsports.brightspotcdn.com/dims4/default/77fa525/2147483647/strip/true/crop/1650x928+0+0/resize/1440x810!/quality/90/?url=https%3A%2F%2Fnbc-sports-production-nbc-sports.s3.us-east-1.amazonaws.com%2Fbrightspot%2F75%2F55%2Fa2966fe24d65af1fe1ef10ca3d7b%2Fhttps-delivery-gettyimages.com%2Fdownloads%2F2185479700, 2024-11-26 01:22:26, newsapi, 2024-11-27 10:02:08, 2024-11-27 10:02:08) returning "id")  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: SQLSTATE[22001]: String data, right truncated: 7 ERROR:  value too long for type character varying(255) (Connection: pgsql, SQL: insert into "articles" ("api_id", "source_id", "title", "description", "content", "author", "url", "image_url", "published_at", "api_source", "updated_at", "created_at") values (6e94fdc61134e990289cec25d9445884, 124, Raiders designate Aidan O’Connell to return from IR - NBC Sports, The Raiders designated quarterback Aidan O'Connell to return from injured reserve Monday, the team announced., The Raiders designated quarterback Aidan OConnell to return from injured reserve Monday, the team announced.
Coach Antonio Pierce said OConnell will participate in a walk-through Tuesday but wouldnt… [+1033 chars], Charean Williams, https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/raiders-designate-aidan-oconnell-to-return-from-ir, https://nbcsports.brightspotcdn.com/dims4/default/f57254f/2147483647/strip/true/crop/6734x3788+0+0/resize/1440x810!/quality/90/?url=https%3A%2F%2Fnbc-sports-production-nbc-sports.s3.us-east-1.amazonaws.com%2Fbrightspot%2F90%2F3d%2Fcb8f3f674d7e80005b81d5345f79%2Fhttps-delivery-gettyimages.com%2Fdownloads%2F2179740108, 2024-11-25 22:48:53, newsapi, 2024-11-27 10:02:08, 2024-11-27 10:02:08) returning "id")  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: SQLSTATE[22001]: String data, right truncated: 7 ERROR:  value too long for type character varying(255) (Connection: pgsql, SQL: insert into "articles" ("api_id", "source_id", "title", "description", "content", "author", "url", "image_url", "published_at", "api_source", "updated_at", "created_at") values (9b38070a0423cf9364bb8e922ec6dcea, 124, NFL Playoff Picture 2024: Updated AFC and NFC Standings, bracket, tiebreakers after Week 12 - NBC Sports, The NFL playoff race is heating up heading into Thanksgiving, and here's how the playoff picture is shaping up before Monday Night Football in Week 12: DIVISION LEADERS 1., The NFL playoff race is heating up heading into Thanksgiving, and heres how the playoff picture is shaping up before Monday Night Football in Week 12:
NFC Playoff Picture 
DIVISION LEADERS1. Detroi… [+2540 chars], Michael David Smith, https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/nfl-playoff-picture-2024-updated-afc-and-nfc-standings-bracket-tiebreakers-after-week-12, https://nbcsports.brightspotcdn.com/dims4/default/b4eb94c/2147483647/strip/true/crop/3226x1815+0+168/resize/1440x810!/quality/90/?url=https%3A%2F%2Fnbc-sports-production-nbc-sports.s3.us-east-1.amazonaws.com%2Fbrightspot%2F65%2F25%2F39973f364d04b2339b2ed5826993%2Fhttps-delivery-gettyimages.com%2Fdownloads%2F2186692702, 2024-11-25 14:59:26, newsapi, 2024-11-27 10:02:08, 2024-11-27 10:02:08) returning "id")  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.ERROR: Error processing NewsAPI article: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:08] local.INFO: NewsAPI: Processed 0 articles, skipped 43  
[2024-11-27 10:02:09] local.INFO: NewsAPI: Fetched total of 266 articles from categories  
[2024-11-27 10:02:11] local.ERROR: Guardian fetch failed: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 10:02:13] local.ERROR: NY Times fetch failed: Please install the suggested Algolia client: algolia/algoliasearch-client-php.  
[2024-11-27 11:48:37] local.ERROR: SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation "personal_access_tokens" does not exist
LINE 1: insert into "personal_access_tokens" ("name", "token", "abil...
                    ^ (Connection: pgsql, SQL: insert into "personal_access_tokens" ("name", "token", "abilities", "expires_at", "tokenable_id", "tokenable_type", "updated_at", "created_at") values (auth_token, 1cca415270705bf2a338394d37a067ab6f28f03137e58dcbca3be458797bdb3a, ["*"], ?, 1, App\Models\User, 2024-11-27 11:48:37, 2024-11-27 11:48:37) returning "id") {"exception":"[object] (Illuminate\\Database\\QueryException(code: 42P01): SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation \"personal_access_tokens\" does not exist
LINE 1: insert into \"personal_access_tokens\" (\"name\", \"token\", \"abil...
                    ^ (Connection: pgsql, SQL: insert into \"personal_access_tokens\" (\"name\", \"token\", \"abilities\", \"expires_at\", \"tokenable_id\", \"tokenable_type\", \"updated_at\", \"created_at\") values (auth_token, 1cca415270705bf2a338394d37a067ab6f28f03137e58dcbca3be458797bdb3a, [\"*\"], ?, 1, App\\Models\\User, 2024-11-27 11:48:37, 2024-11-27 11:48:37) returning \"id\") at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:825)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('insert into \"pe...', Array, Object(Closure))
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(398): Illuminate\\Database\\Connection->run('insert into \"pe...', Array, Object(Closure))
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(385): Illuminate\\Database\\Connection->select('insert into \"pe...', Array, false)
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Processors/PostgresProcessor.php(24): Illuminate\\Database\\Connection->selectFromWriteConnection('insert into \"pe...', Array)
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3799): Illuminate\\Database\\Query\\Processors\\PostgresProcessor->processInsertGetId(Object(Illuminate\\Database\\Query\\Builder), 'insert into \"pe...', Array, 'id')
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(2049): Illuminate\\Database\\Query\\Builder->insertGetId(Array, 'id')
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php(1358): Illuminate\\Database\\Eloquent\\Builder->__call('insertGetId', Array)
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php(1323): Illuminate\\Database\\Eloquent\\Model->insertAndSetId(Object(Illuminate\\Database\\Eloquent\\Builder), Array)
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php(1162): Illuminate\\Database\\Eloquent\\Model->performInsert(Object(Illuminate\\Database\\Eloquent\\Builder))
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Relations/HasOneOrMany.php(371): Illuminate\\Database\\Eloquent\\Model->save()
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Support/helpers.php(393): Illuminate\\Database\\Eloquent\\Relations\\HasOneOrMany->Illuminate\\Database\\Eloquent\\Relations\\{closure}(Object(Laravel\\Sanctum\\PersonalAccessToken))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Relations/HasOneOrMany.php(368): tap(Object(Laravel\\Sanctum\\PersonalAccessToken), Object(Closure))
#12 /var/www/html/vendor/laravel/sanctum/src/HasApiTokens.php(53): Illuminate\\Database\\Eloquent\\Relations\\HasOneOrMany->create(Array)
#13 /var/www/html/app/Http/Controllers/Api/AuthController.php(22): App\\Models\\User->createToken('auth_token')
#14 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/ControllerDispatcher.php(46): App\\Http\\Controllers\\Api\\AuthController->register(Object(App\\Http\\Requests\\Auth\\RegisterRequest))
#15 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(265): Illuminate\\Routing\\ControllerDispatcher->dispatch(Object(Illuminate\\Routing\\Route), Object(App\\Http\\Controllers\\Api\\AuthController), 'register')
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(211): Illuminate\\Routing\\Route->runController()
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(808): Illuminate\\Routing\\Route->run()
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Routing\\Router->Illuminate\\Routing\\{closure}(Object(Illuminate\\Http\\Request))
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Middleware/SubstituteBindings.php(51): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Routing\\Middleware\\SubstituteBindings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(807): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(786): Illuminate\\Routing\\Router->runRouteWithinStack(Object(Illuminate\\Routing\\Route), Object(Illuminate\\Http\\Request))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(750): Illuminate\\Routing\\Router->runRoute(Object(Illuminate\\Http\\Request), Object(Illuminate\\Routing\\Route))
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(739): Illuminate\\Routing\\Router->dispatchToRoute(Object(Illuminate\\Http\\Request))
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(201): Illuminate\\Routing\\Router->dispatch(Object(Illuminate\\Http\\Request))
#27 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Foundation\\Http\\Kernel->Illuminate\\Foundation\\Http\\{closure}(Object(Illuminate\\Http\\Request))
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#29 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/ConvertEmptyStringsToNull.php(31): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#30 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\ConvertEmptyStringsToNull->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#31 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#32 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TrimStrings.php(51): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#33 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\TrimStrings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#34 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/ValidatePostSize.php(27): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#35 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\ValidatePostSize->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#36 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/PreventRequestsDuringMaintenance.php(110): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#37 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\PreventRequestsDuringMaintenance->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#38 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/HandleCors.php(62): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#39 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\HandleCors->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#40 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/TrustProxies.php(58): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#41 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\TrustProxies->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#42 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/InvokeDeferredCallbacks.php(22): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#43 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\InvokeDeferredCallbacks->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#44 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#45 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(176): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#46 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(145): Illuminate\\Foundation\\Http\\Kernel->sendRequestThroughRouter(Object(Illuminate\\Http\\Request))
#47 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1190): Illuminate\\Foundation\\Http\\Kernel->handle(Object(Illuminate\\Http\\Request))
#48 /var/www/html/public/index.php(17): Illuminate\\Foundation\\Application->handleRequest(Object(Illuminate\\Http\\Request))
#49 {main}

[previous exception] [object] (PDOException(code: 42P01): SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation \"personal_access_tokens\" does not exist
LINE 1: insert into \"personal_access_tokens\" (\"name\", \"token\", \"abil...
                    ^ at /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php:412)
[stacktrace]
#0 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(412): PDOStatement->execute()
#1 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(812): Illuminate\\Database\\Connection->Illuminate\\Database\\{closure}('insert into \"pe...', Array)
#2 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(779): Illuminate\\Database\\Connection->runQueryCallback('insert into \"pe...', Array, Object(Closure))
#3 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(398): Illuminate\\Database\\Connection->run('insert into \"pe...', Array, Object(Closure))
#4 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Connection.php(385): Illuminate\\Database\\Connection->select('insert into \"pe...', Array, false)
#5 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Processors/PostgresProcessor.php(24): Illuminate\\Database\\Connection->selectFromWriteConnection('insert into \"pe...', Array)
#6 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Query/Builder.php(3799): Illuminate\\Database\\Query\\Processors\\PostgresProcessor->processInsertGetId(Object(Illuminate\\Database\\Query\\Builder), 'insert into \"pe...', Array, 'id')
#7 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Builder.php(2049): Illuminate\\Database\\Query\\Builder->insertGetId(Array, 'id')
#8 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php(1358): Illuminate\\Database\\Eloquent\\Builder->__call('insertGetId', Array)
#9 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php(1323): Illuminate\\Database\\Eloquent\\Model->insertAndSetId(Object(Illuminate\\Database\\Eloquent\\Builder), Array)
#10 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php(1162): Illuminate\\Database\\Eloquent\\Model->performInsert(Object(Illuminate\\Database\\Eloquent\\Builder))
#11 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Relations/HasOneOrMany.php(371): Illuminate\\Database\\Eloquent\\Model->save()
#12 /var/www/html/vendor/laravel/framework/src/Illuminate/Support/helpers.php(393): Illuminate\\Database\\Eloquent\\Relations\\HasOneOrMany->Illuminate\\Database\\Eloquent\\Relations\\{closure}(Object(Laravel\\Sanctum\\PersonalAccessToken))
#13 /var/www/html/vendor/laravel/framework/src/Illuminate/Database/Eloquent/Relations/HasOneOrMany.php(368): tap(Object(Laravel\\Sanctum\\PersonalAccessToken), Object(Closure))
#14 /var/www/html/vendor/laravel/sanctum/src/HasApiTokens.php(53): Illuminate\\Database\\Eloquent\\Relations\\HasOneOrMany->create(Array)
#15 /var/www/html/app/Http/Controllers/Api/AuthController.php(22): App\\Models\\User->createToken('auth_token')
#16 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/ControllerDispatcher.php(46): App\\Http\\Controllers\\Api\\AuthController->register(Object(App\\Http\\Requests\\Auth\\RegisterRequest))
#17 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(265): Illuminate\\Routing\\ControllerDispatcher->dispatch(Object(Illuminate\\Routing\\Route), Object(App\\Http\\Controllers\\Api\\AuthController), 'register')
#18 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Route.php(211): Illuminate\\Routing\\Route->runController()
#19 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(808): Illuminate\\Routing\\Route->run()
#20 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Routing\\Router->Illuminate\\Routing\\{closure}(Object(Illuminate\\Http\\Request))
#21 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Middleware/SubstituteBindings.php(51): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#22 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Routing\\Middleware\\SubstituteBindings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#23 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#24 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(807): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#25 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(786): Illuminate\\Routing\\Router->runRouteWithinStack(Object(Illuminate\\Routing\\Route), Object(Illuminate\\Http\\Request))
#26 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(750): Illuminate\\Routing\\Router->runRoute(Object(Illuminate\\Http\\Request), Object(Illuminate\\Routing\\Route))
#27 /var/www/html/vendor/laravel/framework/src/Illuminate/Routing/Router.php(739): Illuminate\\Routing\\Router->dispatchToRoute(Object(Illuminate\\Http\\Request))
#28 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(201): Illuminate\\Routing\\Router->dispatch(Object(Illuminate\\Http\\Request))
#29 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(144): Illuminate\\Foundation\\Http\\Kernel->Illuminate\\Foundation\\Http\\{closure}(Object(Illuminate\\Http\\Request))
#30 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#31 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/ConvertEmptyStringsToNull.php(31): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#32 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\ConvertEmptyStringsToNull->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#33 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TransformsRequest.php(21): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#34 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/TrimStrings.php(51): Illuminate\\Foundation\\Http\\Middleware\\TransformsRequest->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#35 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\TrimStrings->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#36 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/ValidatePostSize.php(27): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#37 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\ValidatePostSize->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#38 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/PreventRequestsDuringMaintenance.php(110): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#39 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\PreventRequestsDuringMaintenance->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#40 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/HandleCors.php(62): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#41 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\HandleCors->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#42 /var/www/html/vendor/laravel/framework/src/Illuminate/Http/Middleware/TrustProxies.php(58): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#43 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Http\\Middleware\\TrustProxies->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#44 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/InvokeDeferredCallbacks.php(22): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#45 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(183): Illuminate\\Foundation\\Http\\Middleware\\InvokeDeferredCallbacks->handle(Object(Illuminate\\Http\\Request), Object(Closure))
#46 /var/www/html/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php(119): Illuminate\\Pipeline\\Pipeline->Illuminate\\Pipeline\\{closure}(Object(Illuminate\\Http\\Request))
#47 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(176): Illuminate\\Pipeline\\Pipeline->then(Object(Closure))
#48 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Http/Kernel.php(145): Illuminate\\Foundation\\Http\\Kernel->sendRequestThroughRouter(Object(Illuminate\\Http\\Request))
#49 /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php(1190): Illuminate\\Foundation\\Http\\Kernel->handle(Object(Illuminate\\Http\\Request))
#50 /var/www/html/public/index.php(17): Illuminate\\Foundation\\Application->handleRequest(Object(Illuminate\\Http\\Request))
#51 {main}
"} 

```

# backend/tailwind.config.js

```js
import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './vendor/laravel/framework/src/Illuminate/Pagination/resources/views/*.blade.php',
        './storage/framework/views/*.php',
        './resources/**/*.blade.php',
        './resources/**/*.js',
        './resources/**/*.vue',
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Figtree', ...defaultTheme.fontFamily.sans],
            },
        },
    },
    plugins: [],
};

```

# backend/tests/Feature/ExampleTest.php

```php
<?php

namespace Tests\Feature;

// use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExampleTest extends TestCase
{
    /**
     * A basic test example.
     */
    public function test_the_application_returns_a_successful_response(): void
    {
        $response = $this->get('/');

        $response->assertStatus(200);
    }
}

```

# backend/tests/TestCase.php

```php
<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    //
}

```

# backend/tests/Unit/ExampleTest.php

```php
<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class ExampleTest extends TestCase
{
    /**
     * A basic test example.
     */
    public function test_that_true_is_true(): void
    {
        $this->assertTrue(true);
    }
}

```

# backend/vite.config.js

```js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
        }),
    ],
});

```

# docker-compose.yml

```yml
version: '3.8'

services:
  # Backend Laravel Service
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: news-backend
    restart: unless-stopped
    working_dir: /var/www/html
    volumes:
      - ./backend:/var/www/html
      - /var/www/html/vendor  # Prevents overwriting vendor directory
      - /var/www/html/node_modules  # Prevents overwriting node_modules
    networks:
      - news-network
    depends_on:
      - db

  # Frontend React Service
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: news-frontend
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules  # Prevents overwriting node_modules
    environment:
      - CHOKIDAR_USEPOLLING=true  # Enable hot reload on Windows/MacOS
      - WATCHPACK_POLLING=true    # Enable hot reload for newer versions
      - WDS_SOCKET_PORT=0         # Required for newer Create React App versions
    networks:
      - news-network
    command: npm start   # Override Dockerfile CMD to use development server

  # Nginx Service
  nginx:
    image: nginx:alpine
    container_name: news-nginx
    restart: unless-stopped
    ports:
      - "8000:80"
    volumes:
      - ./backend:/var/www/html
      - ./docker/nginx:/etc/nginx/conf.d
    networks:
      - news-network
    depends_on:
      - backend

  # PostgreSQL Service
  db:
    image: postgres:15-alpine
    container_name: news-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: news_aggregator
      POSTGRES_USER: news_user
      POSTGRES_PASSWORD: news_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - news-network
    ports:
      - "5432:5432"

networks:
  news-network:
    driver: bridge

volumes:
  postgres_data:
```

# docker/nginx/default.conf

```conf
server {
    listen 80;
    server_name localhost;
    root /var/www/html/public;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    index index.php;

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \.php$ {
        fastcgi_pass backend:9000;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }
}
```

# frontend/.eslintrc.json

```json
{
  "env": {
    "browser": true,
    "es2021": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaFeatures": {
      "jsx": true
    },
    "ecmaVersion": "latest",
    "sourceType": "module"
  },
  "plugins": ["react", "@typescript-eslint"],
  "rules": {
    "react/react-in-jsx-scope": "off",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "react/prop-types": "off"
  },
  "settings": {
    "react": {
      "version": "detect"
    }
  }
}

```

# frontend/.gitignore

```
# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# dependencies
/node_modules
/.pnp
.pnp.js

# testing
/coverage

# production
/build

# misc
.DS_Store
.env.local
.env.development.local
.env.test.local
.env.production.local

npm-debug.log*
yarn-debug.log*
yarn-error.log*

```

# frontend/.prettierrc.json

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}

```

# frontend/Dockerfile

```
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with legacy peer deps flag
RUN npm install --legacy-peer-deps

# Copy app files
COPY . .

EXPOSE 3000

# Start the app
CMD ["npm", "start"]
```

# frontend/package.json

```json
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@headlessui/react": "^2.2.0",
    "@heroicons/react": "^2.2.0",
    "@tailwindcss/forms": "^0.5.9",
    "@tailwindcss/typography": "^0.5.15",
    "@tanstack/react-query": "^5.61.4",
    "@testing-library/jest-dom": "^5.17.0",
    "@testing-library/react": "^13.4.0",
    "@testing-library/user-event": "^13.5.0",
    "axios": "^1.7.8",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.53.2",
    "react-hot-toast": "^2.4.1",
    "react-router-dom": "^7.0.1",
    "react-scripts": "5.0.1",
    "web-vitals": "^2.1.4"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx}\""
  },
  "eslintConfig": {
    "extends": [
      "react-app",
      "react-app/jest"
    ]
  },
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },
  "devDependencies": {
    "@types/axios": "^0.9.36",
    "@types/node": "^22.10.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@typescript-eslint/eslint-plugin": "^8.16.0",
    "@typescript-eslint/parser": "^8.16.0",
    "ajv": "^8.17.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.15",
    "typescript": "^5.7.2"
  }
}

```

# frontend/postcss.config.js

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}

```

# frontend/public/favicon.ico

This is a binary file of the type: Binary

# frontend/public/index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#000000" />
    <meta
      name="description"
      content="Web site created using create-react-app"
    />
    <link rel="apple-touch-icon" href="%PUBLIC_URL%/logo192.png" />
    <!--
      manifest.json provides metadata used when your web app is installed on a
      user's mobile device or desktop. See https://developers.google.com/web/fundamentals/web-app-manifest/
    -->
    <link rel="manifest" href="%PUBLIC_URL%/manifest.json" />
    <!--
      Notice the use of %PUBLIC_URL% in the tags above.
      It will be replaced with the URL of the `public` folder during the build.
      Only files inside the `public` folder can be referenced from the HTML.

      Unlike "/favicon.ico" or "favicon.ico", "%PUBLIC_URL%/favicon.ico" will
      work correctly both with client-side routing and a non-root public URL.
      Learn how to configure a non-root public URL by running `npm run build`.
    -->
    <title>React App</title>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
    <!--
      This HTML file is a template.
      If you open it directly in the browser, you will see an empty page.

      You can add webfonts, meta tags, or analytics to this file.
      The build step will place the bundled scripts into the <body> tag.

      To begin the development, run `npm start` or `yarn start`.
      To create a production bundle, use `npm run build` or `yarn build`.
    -->
  </body>
</html>

```

# frontend/public/logo192.png

This is a binary file of the type: Image

# frontend/public/logo512.png

This is a binary file of the type: Image

# frontend/public/manifest.json

```json
{
  "short_name": "React App",
  "name": "Create React App Sample",
  "icons": [
    {
      "src": "favicon.ico",
      "sizes": "64x64 32x32 24x24 16x16",
      "type": "image/x-icon"
    },
    {
      "src": "logo192.png",
      "type": "image/png",
      "sizes": "192x192"
    },
    {
      "src": "logo512.png",
      "type": "image/png",
      "sizes": "512x512"
    }
  ],
  "start_url": ".",
  "display": "standalone",
  "theme_color": "#000000",
  "background_color": "#ffffff"
}

```

# frontend/public/robots.txt

```txt
# https://www.robotstxt.org/robotstxt.html
User-agent: *
Disallow:

```

# frontend/README.md

```md
# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

```

# frontend/src/App.tsx

```tsx
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouter } from "./router";
import { AuthProvider } from "./context/authContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
}); 

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

```

# frontend/src/components/Articles/ArticleCard/index.tsx

```tsx
import React from "react";
import { Link } from "react-router-dom";
import { Article } from "../../../types";

interface ArticleCardProps {
  article: Article;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {article.image_url && (
        <img
          className="h-48 w-full object-cover"
          src={article.image_url}
          alt={article.title}
        />
      )}
      <div className="p-6">
        <p className="text-sm font-medium text-primary-600">
          {article.source.name}
        </p>
        <Link to={`/articles/${article.id}`} className="mt-2 block">
          <p className="text-xl font-semibold text-gray-900">{article.title}</p>
          <p className="mt-3 text-base text-gray-500">{article.description}</p>
        </Link>
        <div className="mt-6 flex items-center">
          <div className="flex-shrink-0">
            <span className="sr-only">{article.author}</span>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-gray-900">
              {article.author}
            </p>
            <div className="flex space-x-1 text-sm text-gray-500">
              <time dateTime={article.published_at}>
                {new Date(article.published_at).toLocaleDateString()}
              </time>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

```

# frontend/src/components/Articles/ArticleFilters/index.tsx

```tsx
import type { ArticleFilters } from '../../../types';

interface FiltersProps {
  filters: ArticleFilters;
  onFilterChange: (filters: ArticleFilters) => void;
}

export default function ArticleFilters({ filters, onFilterChange }: FiltersProps) {
  const handleChange = (key: keyof ArticleFilters, value: string | string[]) => {
    onFilterChange({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div>
        <input
          type="text"
          placeholder="Search articles..."
          value={filters.search}
          onChange={(e) => handleChange('search', e.target.value)}
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Date Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700">From Date</label>
          <input
            type="date"
            value={filters.from_date || ''}
            onChange={(e) => handleChange('from_date', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">To Date</label>
          <input
            type="date"
            value={filters.to_date || ''}
            onChange={(e) => handleChange('to_date', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>

        {/* Sort */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Sort By</label>
          <select
            value={filters.sort_by || 'published_at'}
            onChange={(e) => handleChange('sort_by', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          >
            <option value="published_at">Date</option>
            <option value="title">Title</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Sort Order</label>
          <select
            value={filters.sort_order || 'desc'}
            onChange={(e) => handleChange('sort_order', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          >
            <option value="desc">Newest First</option>
            <option value="asc">Oldest First</option>
          </select>
        </div>
      </div>
    </div>
  );
}

```

# frontend/src/components/Articles/ArticleGrid/index.tsx

```tsx
import React from "react";
import ArticleCard from "../ArticleCard";
import { Article } from "../../../types";

interface ArticleGridProps {
  articles: Article[];
  isLoading: boolean;
}

export default function ArticleGrid({ articles, isLoading }: ArticleGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-200 h-48 rounded-t-lg" />
            <div className="p-6 bg-white rounded-b-lg">
              <div className="h-4 bg-gray-200 rounded w-1/4" />
              <div className="h-6 bg-gray-200 rounded mt-2" />
              <div className="h-4 bg-gray-200 rounded mt-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </div>
  );
}

```

# frontend/src/components/Auth/ProtectedRoute/index.tsx

```tsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../context/authContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

```

# frontend/src/components/Layout/Header.tsx

```tsx
import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/authContext";

export default function Header() {
  const { isAuthenticated, logout, user } = useAuth();

  return (
    <header className="bg-white shadow">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between">
          <div className="flex">
            <Link to="/" className="flex items-center">
              <span className="text-xl font-bold text-gray-900">
                NewsAggregators
              </span>
            </Link>
          </div>

          <div className="flex items-center">
            {isAuthenticated ? (
              <div className="flex items-center space-x-4">
                <span className="text-gray-700">{user?.name}</span>
                <Link
                  to="/preferences"
                  className="text-gray-600 hover:text-gray-900"
                >
                  Preferences
                </Link>
                <button
                  onClick={logout}
                  className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="space-x-4">
                <Link
                  to="/login"
                  className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-500"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}

```

# frontend/src/components/Layout/index.tsx

```tsx
import React from "react";
import Header from "./Header";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}

```

# frontend/src/components/types/components.d.ts

```ts
import { ButtonHTMLAttributes, InputHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "secondary"
    | "destructive"
    | "outline"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg";
  isLoading?: boolean;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline";
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "destructive";
}

```

# frontend/src/context/authContext.tsx

```tsx
import { authApi } from '../services/api';
import { LoginCredentials, RegisterCredentials, User } from '@/types';
import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const login = async (credentials: LoginCredentials) => {
    try {
      const response = await authApi.login(credentials);
      setToken(response.token);
      setUser(response.user);
      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const register = async (credentials: RegisterCredentials) => {
    try {
      const response = await authApi.register(credentials);
      setToken(response.token);
      setUser(response.user);
      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setToken(null);
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
        logout,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

```

# frontend/src/hooks/useArticle.ts

```ts
import { useQuery } from "@tanstack/react-query";
import { articlesApi } from "../services/api";

export function useArticle(id: number) {
  return useQuery({
    queryKey: ["article", id],
    queryFn: () => articlesApi.getArticle(id),
  });
}

```

# frontend/src/hooks/useArticles.ts

```ts
import { useQuery } from "@tanstack/react-query";
import { articlesApi } from "../services/api";
import type { ArticleFilters } from "../types";

export function useArticles(filters: ArticleFilters) {
  return useQuery({
    queryKey: ["articles", filters],
    queryFn: () => articlesApi.getArticles(filters),
  });
}

```

# frontend/src/hooks/usePreferences.ts

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { preferencesApi } from "../services/api";
import type { PreferenceUpdatePayload } from "../types";

export function usePreferences() {
  return useQuery({
    queryKey: ["preferences"],
    queryFn: () => preferencesApi.getPreferences(),
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (preferences: PreferenceUpdatePayload) =>
      preferencesApi.updatePreferences(preferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
      queryClient.invalidateQueries({ queryKey: ["userFeed"] });
    },
  });
}

```

# frontend/src/hooks/useUserFeed.ts

```ts
import { useQuery } from "@tanstack/react-query";
import { articlesApi } from "../services/api";
import type { ArticleFilters } from "../types";

export function useUserFeed(filters: Partial<ArticleFilters>) {
  return useQuery({
    queryKey: ["userFeed", filters],
    queryFn: () => articlesApi.getUserFeed(filters),
  });
}

```

# frontend/src/index.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
/* 
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}

@layer components {
  .btn {
    @apply inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background;
  }

  .btn-primary {
    @apply bg-primary text-primary-foreground hover:bg-primary/90;
  }

  .btn-secondary {
    @apply bg-secondary text-secondary-foreground hover:bg-secondary/80;
  }

  .btn-destructive {
    @apply bg-destructive text-destructive-foreground hover:bg-destructive/90;
  }

  .input {
    @apply flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50;
  }

  .badge {
    @apply inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2;
  }

  .card {
    @apply rounded-lg border bg-card text-card-foreground shadow-sm;
  }

  .dropdown-menu {
    @apply z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2;
  }
} */

```

# frontend/src/index.tsx

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


```

# frontend/src/logo.svg

This is a file of the type: SVG Image

# frontend/src/pages/Articles/index.tsx

```tsx
import React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { articlesApi } from "../../services/api";

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const { data: article, isLoading } = useQuery({
    queryKey: ["article", id],
    queryFn: () => articlesApi.getArticle(Number(id)!),
  });

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-3/4" />
        <div className="mt-4 h-4 bg-gray-200 rounded w-1/4" />
        <div className="mt-8 h-4 bg-gray-200 rounded" />
        <div className="mt-2 h-4 bg-gray-200 rounded" />
        <div className="mt-2 h-4 bg-gray-200 rounded w-5/6" />
      </div>
    );
  }

  if (!article) return null;

  return (
    <article className="prose lg:prose-xl mx-auto">
      <h1>{article.title}</h1>
      <div className="flex items-center text-gray-500 text-sm">
        <span>{article.source.name}</span>
        <span className="mx-2">•</span>
        <time dateTime={article.published_at}>
          {new Date(article.published_at).toLocaleDateString()}
        </time>
        {article.author && (
          <>
            <span className="mx-2">•</span>
            <span>{article.author}</span>
          </>
        )}
      </div>
      {article.image_url && (
        <img
          src={article.image_url}
          alt={article.title}
          className="my-8 rounded-lg shadow-lg"
        />
      )}
      <div dangerouslySetInnerHTML={{ __html: article.content! }} />
    </article>
  );
}

```

# frontend/src/pages/Home/index.tsx

```tsx
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/authContext';
import { articlesApi } from '../../services/api';
import ArticleGrid from '../../components/Articles/ArticleGrid';
import { ArticleFilters as ArticleFiltersType } from '../../types';
import ArticleFilters from '../../components/Articles/ArticleFilters';

export default function HomePage() {
  const { isAuthenticated } = useAuth();
  const [filters, setFilters] = React.useState<ArticleFiltersType>({
    search: '',
    from_date: '',
    to_date: '',
    sort_by: 'published_at',
    sort_order: 'desc',
    categories: [],
    sources: [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ['articles', filters],
    queryFn: () => articlesApi.getArticles(filters),
  });

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-lg shadow">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          {isAuthenticated ? 'Your News Feed' : 'Latest News'}
        </h1>
        <ArticleFilters filters={filters} onFilterChange={setFilters} />
      </div>

      <ArticleGrid articles={data?.data || []} isLoading={isLoading} />
    </div>
  );
}

```

# frontend/src/pages/Login/index.tsx

```tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';

import { useAuth } from '../../context/authContext';
import { LoginCredentials } from '@/types';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginCredentials>();

  const onSubmit = async (credentials: LoginCredentials) => {
    try {
      setError(null);
      await login(credentials);
      navigate('/', { replace: true });
    } catch (err) {
      setError('Failed to login. Please check your credentials.');
      console.error('Login failed:', err);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-md space-y-8 p-6 bg-white rounded-xl shadow-md">
        <div>
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
            Sign in to your account
          </h2>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
            {error}
          </div>
        )}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 rounded-md">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                type="email"
                {...register('email', { required: 'Email is required' })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-primary-500"
              />
              {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                {...register('password', { required: 'Password is required' })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-primary-500"
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="text-center text-sm text-gray-600">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="font-medium text-primary-600 hover:text-primary-500">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

```

# frontend/src/pages/Preferences/index.tsx

```tsx
import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { preferencesApi } from '../../services/api';
import type { PreferencesResponse, PreferenceUpdatePayload } from '../../types';

export default function PreferencesPage() {
  const queryClient = useQueryClient();
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [selectedSources, setSelectedSources] = useState<number[]>([]);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [updateFrequency, setUpdateFrequency] = useState<'daily' | 'weekly' | 'never'>(
    'daily'
  );

  const { data, isLoading } = useQuery<PreferencesResponse, Error>({
    queryKey: ['preferences'],
    queryFn: preferencesApi.getPreferences,
  });

  const { mutate: updatePreferences, isPending } = useMutation({
    mutationFn: (preferences: PreferenceUpdatePayload) =>
      preferencesApi.updatePreferences(preferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });

  const handleCategoryToggle = (categoryId: number) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId) ? prev.filter((id) => id !== categoryId) : [...prev, categoryId]
    );
  };

  useEffect(() => {
    if (data?.preferences) {
      setSelectedCategories(data.preferences.preferred_categories);
      setSelectedSources(data.preferences.preferred_sources);
      setEmailNotifications(data.preferences.email_notifications);
      setUpdateFrequency(data.preferences.update_frequency);
    }
  }, [data]);

  const handleSourceToggle = (sourceId: number) => {
    setSelectedSources((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    );
  };

  const handleSave = () => {
    updatePreferences({
      preferred_categories: selectedCategories,
      preferred_sources: selectedSources,
      email_notifications: emailNotifications,
      update_frequency: updateFrequency,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">News Preferences</h2>
        <p className="mt-1 text-gray-600">
          Customize your news feed by selecting your preferred categories and sources.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Categories</h3>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {data?.available_categories.map((category) => (
              <label key={category.id} className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600"
                  checked={selectedCategories.includes(category.id)}
                  onChange={() => handleCategoryToggle(category.id)}
                />
                <span className="text-gray-900">{category.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900">Sources</h3>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {data?.available_sources.map((source) => (
              <label key={source.id} className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600"
                  checked={selectedSources.includes(source.id)}
                  onChange={() => handleSourceToggle(source.id)}
                />
                <span className="text-gray-900">{source.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900">Notification Preferences</h3>
          <div className="mt-4 space-y-4">
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary-600"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
              />
              <span className="text-gray-900">Receive email notifications</span>
            </label>

            <div>
              <label className="block text-sm font-medium text-gray-700">Update Frequency</label>
              <select
                value={updateFrequency}
                onChange={(e) => setUpdateFrequency(e.target.value as 'daily' | 'weekly' | 'never')}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isPending ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}

```

# frontend/src/pages/Register/index.tsx

```tsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";

import { useAuth } from "../../context/authContext";
import { RegisterCredentials } from "@/types";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterCredentials>();

  const password = watch("password");

  const onSubmit = async (data: RegisterCredentials) => {
    try {
      setError(null);
      await registerUser(data);
      navigate("/", { replace: true });
    } catch (err) {
      setError("Registration failed. Please try again.");
      console.error("Registration failed:", err);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-md space-y-8 p-6 bg-white rounded-xl shadow-md">
        <div>
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
            Create your account
          </h2>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
            {error}
          </div>
        )}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 rounded-md">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700"
              >
                Full Name
              </label>
              <input
                id="name"
                type="text"
                {...register("name", { required: "Name is required" })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                {...register("email", {
                  required: "Email is required",
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: "Invalid email address",
                  },
                })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                {...register("password", {
                  required: "Password is required",
                  minLength: {
                    value: 8,
                    message: "Password must be at least 8 characters",
                  },
                })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="password_confirmation"
                className="block text-sm font-medium text-gray-700"
              >
                Confirm Password
              </label>
              <input
                id="password_confirmation"
                type="password"
                {...register("password_confirmation", {
                  required: "Please confirm your password",
                  validate: (value) =>
                    value === password || "Passwords do not match",
                })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
              {errors.password_confirmation && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.password_confirmation.message}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>

          <p className="text-center text-sm text-gray-600">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-medium text-primary-600 hover:text-primary-500"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

```

# frontend/src/router/index.tsx

```tsx
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';

import ProtectedRoute from '../components/Auth/ProtectedRoute';
import Layout from '../components/Layout';
import HomePage from '../pages/Home';
import ArticlePage from '../pages/Articles';
import LoginPage from '../pages/Login';
import RegisterPage from '../pages/Register';
import PreferencesPage from '../pages/Preferences';

const RootLayout = () => {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
};

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: 'articles/:id',
        element: <ArticlePage />,
      },
      {
        path: 'login',
        element: <LoginPage />,
      },
      {
        path: 'register',
        element: <RegisterPage />,
      },
      {
        path: 'preferences',
        element: (
          <ProtectedRoute>
            <PreferencesPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}

```

# frontend/src/services/api.ts

```ts
import axios from 'axios';
import { PreferencesResponse } from '../types/index';
import type {
  Article,
  PaginatedResponse,
  LoginCredentials,
  RegisterCredentials,
  AuthResponse,
  UserPreferences,
  ArticleFilters,
  PreferenceUpdatePayload,
  ApiError,
} from '../types';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers!.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/login', credentials);
    return response.data;
  },

  register: async (credentials: RegisterCredentials): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/register', credentials);
    return response.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/logout');
  },
};

export const articlesApi = {
  getArticles: async (filters: ArticleFilters): Promise<PaginatedResponse<Article>> => {
    const response = await api.get<PaginatedResponse<Article>>('/articles', {
      params: filters,
    });
    return response.data;
  },

  getArticle: async (id: number): Promise<Article> => {
    const response = await api.get<Article>(`/articles/${id}`);
    return response.data;
  },

  getUserFeed: async (filters: Partial<ArticleFilters>): Promise<PaginatedResponse<Article>> => {
    const response = await api.get<PaginatedResponse<Article>>('/articles/feed', {
      params: filters,
    });
    return response.data;
  },
};

export const preferencesApi = {
  getPreferences: async (): Promise<PreferencesResponse> => {
    const response = await api.get<PreferencesResponse>('/preferences');
    return response.data;
  },

  updatePreferences: async (payload: PreferenceUpdatePayload): Promise<UserPreferences> => {
    const response = await api.put<UserPreferences>('/preferences', payload);
    return response.data;
  },
};

export type { ApiError };
export default api;

```

# frontend/src/types/index.ts

```ts
export interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: number;
  name: string;
  slug: string;
  url?: string;
  api_source: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface Article {
  id: number;
  title: string;
  description: string | null;
  content: string | null;
  author: string | null;
  url: string;
  image_url: string | null;
  published_at: string;
  source: Source;
  categories: Category[];
  api_source: string;
  api_id: string;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  id: number;
  user_id: number;
  preferred_categories: number[];
  preferred_sources: number[];
  preferred_authors: string[];
  email_notifications: boolean;
  update_frequency: 'daily' | 'weekly' | 'never';
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    from: number;
    last_page: number;
    path: string;
    per_page: number;
    to: number;
    total: number;
  };
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials extends LoginCredentials {
  name: string;
  password_confirmation: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface ArticleFilters {
  search?: string;
  categories?: number[];
  sources?: number[];
  authors?: string[];
  from_date?: string;
  to_date?: string;
  sort_by?: 'published_at' | 'title';
  sort_order?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

export interface PreferenceUpdatePayload {
  preferred_categories?: number[];
  preferred_sources?: number[];
  preferred_authors?: string[];
  email_notifications?: boolean;
  update_frequency?: 'daily' | 'weekly' | 'never';
}

export interface PreferencesResponse {
  preferences: UserPreferences;
  available_categories: Category[];
  available_sources: Source[];
}

```

# frontend/tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}
```

# frontend/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "module": "esnext",
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": "src",
    "paths": {
      "@/*": ["*"],
      "@/components/*": ["components/*"],
      "@/pages/*": ["pages/*"],
      "@/services/*": ["services/*"],
      "@/hooks/*": ["hooks/*"],
      "@/types/*": ["types/*"],
      "@/utils/*": ["utils/*"],
      "@/context/*": ["context/*"]
    }
  },
}

```

