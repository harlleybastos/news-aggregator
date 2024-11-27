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
