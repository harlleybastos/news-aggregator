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
