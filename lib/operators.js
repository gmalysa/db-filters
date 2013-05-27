/**
 * Exposes all of the operator definitions, which are spread around multiple files
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

var _ = require('underscore');
var op = require('./operator_base');
var c = require('./conditionals');
var f = require('./functions');

/**
 * Used do specify ordering in order/group by clauses. When used with group by,
 * aggregate functions are allowed, but not in order by. This will not do any
 * consistency checking, so that is all up to you
 */
function OrderFunction(name, fn, field) {
	op.Operator.call(fn);
	this.fn = fn;
	this.field = field;
}
OrderFunction.prototype = new op.Operator();
OrderFunction.prototype.constructor = OrderFunction;

// Get should never be used, only getField(), so we do not implement it

/**
 * @see Operator.getField()
 */
OrderFunction.prototype.getField = function(filter, options) {
	return filter.escapeKey(this.field, options) + ' ' + this.fn;
};

var by = {};
by.$asc = function(field) { return new OrderFunction('$asc', 'ASC', field); }
by.$desc = function(field) { return new OrderFunction('$desc', 'DESC', field); }

// Interface exposed to db-filters.js
module.exports.Operator = op.Operator;
module.exports.RawFunction = op.RawFunction;
module.exports.Conditional = c.Conditional;
module.exports.operators = _.extend({}, op.operators, c.operators, f.operators, by);
