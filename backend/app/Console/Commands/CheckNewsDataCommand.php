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
