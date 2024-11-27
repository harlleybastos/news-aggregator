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
