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
