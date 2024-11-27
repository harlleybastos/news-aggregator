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
