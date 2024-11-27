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
