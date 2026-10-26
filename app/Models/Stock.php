<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One stock in My current stocks or Stocks to monitor, with the shares and
 * average cost entered for it (both empty until entered).
 */
#[Fillable(['ticker', 'list', 'position', 'shares', 'cost'])]
class Stock extends Model
{
    protected function casts(): array
    {
        return [
            'position' => 'integer',
            'shares' => 'float',
            'cost' => 'float',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
