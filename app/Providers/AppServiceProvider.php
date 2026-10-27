<?php

namespace App\Providers;

use Anthropic\Client;
use Composer\CaBundle\CaBundle;
use GuzzleHttp\Client as Guzzle;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Anthropic's client for talking to Claude, made when first needed.
        // Its connection checks Anthropic's certificate against the list in
        // composer/ca-bundle, as YahooFinance does, since PHP on Windows has
        // none. Tests replace the connection with made-up answers.
        $this->app->singleton(Client::class, fn () => new Client(
            apiKey: (string) config('services.anthropic.key'),
            requestOptions: ['transporter' => new Guzzle([
                'verify' => CaBundle::getSystemCaRootBundlePath(),
                'connect_timeout' => 10,
                'timeout' => 180,
            ])],
        ));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
