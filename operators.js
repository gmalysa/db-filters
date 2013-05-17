/**
 * Definition of the operator class and several operators that can be used to implement
 * a lot of comparison semantics cleanly.
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

var mysql = require('mysql');

/******************************************************************************
 * Base class of all operators, a mostly abstract class
 *****************************************************************************/
function Operator() {}

/**
 * Access wrapper that will either return a value, or if it is a nested value,
 * will evaluate it and then return that
 * @param value The value to evaluate
 * @param key The column name of the value being retrieved
 * @param filter The filter context where we're retrieving values
 * @param options Options to be passed to the key escape function if necessary
 * @return String evaluated+escaped version of value
 */
Operator.prototype.eval = function(value, key, filter, options) {
	if (value instanceof Operator) {
		return '('+value.get(key, filter, options)+')';
	}
	else {
		return filter.handle_type(key, value);
	}
};

/**
 * Abstract implementation of get throws an exception, this should be overridden in
 * derived classes
 * @param key The column name being used in this comparison
 * @param filter The filter context where we're retrieving the value
 * @param options Options to be passed to the key escaping function if necessary
 * @return String complete conditional expression
 */
Operator.prototype.get = function(key, filter, options) {
	throw new Error('Call to abstract method db-filters.Operator.get()');
};

/******************************************************************************
 * Base class for all binary conditional operators that use the column name for an
 * lvalue
 *****************************************************************************/
function BinaryConditionFixed(op, value) {
	this.op = op;
	this.value = value;
}
BinaryConditionFixed.prototype = new Operator();
BinaryConditionFixed.prototype.constructor = BinaryConditionFixed;

/**
 * get() implementation, fixed to use the properly written column as the lval, and
 * the given user value as the rval
 * @see Operator.get for parameter information
 */
BinaryConditionFixed.prototype.get = function(key, filter, options) {
	return filter.escapeKey(key, options) + ' ' + this.op + ' ' + this.eval(this.value, key, filter, options);
};

/******************************************************************************
 * Base class for all binary condition operators that accept two proper values, which
 * effectively disregards the column name. However, it is passed to any evaluated
 * expressions, so it can be used to build complex expressions out of simple column-
 * derived ones
 *****************************************************************************/
function BinaryConditionFree(op, lval, rval) {
	this.op = op;
	this.lval = lval;
	this.rval = rval;
}
BinaryConditionFree.prototype = new Operator();
BinaryConditionFree.prototype.constructor = BinaryConditionFree;

/**
 * get() implementation, which performs the comparison on two arbitrary values
 * @see Operator.get for parameter information
 */
BinaryConditionFree.prototype.get = function(key, filter, options) {
	return this.eval(this.lval, key, filter, options) + ' ' + this.op + ' ' + this.eval(this.rval, key, filter, options);
};

/******************************************************************************
 * Checks if a value is in an array, comes in two forms, one that fixes the key and one that
 * allows a free lvalue
 *****************************************************************************/
function ArrayCondition(rval, lval) {
	this.rval = rval;
	this.lval = lval;
}
ArrayCondition.prototype = new Operator();
ArrayCondition.prototype.constructor = ArrayCondition;

/**
 * get() implementation, which sets up the list and does a check with IN()
 * @see Operator.get for parameter information
 */
ArrayCondition.prototype.get = function(key, filter, options) {
	var lval, rval;
	
	if (this.lval === undefined)
		lval = filter.escapeKey(key, options);
	else
		lval = this.eval(this.lval, key, filter, options);

	rval = this.rval.map(function(v) {
		return this.eval(v, key, filter, options);
	}, this);
	return lval + ' IN (' + rval.join(', ') + ')';
};

/******************************************************************************
 * Creates a regular expression comparison
 *****************************************************************************/
function RegexCondition(pattern) {
	if (pattern instanceof RegExp) {
		pattern = pattern.toString();
		this.pattern = pattern.substr(1, pattern.length-2);
	}
	else {
		this.pattern = pattern+'';
	}
}
RegexCondition.prototype = new Operator();
RegexCondition.prototype.constructor = RegexCondition;

/**
 * get() implementation, this simply treats value as a string always because other
 * possibilities don't make sense
 * @see Operator.get for parameter information
 */
RegexCondition.prototype.get = function(key, filter, options) {
	return filter.escapeKey(key, options) + ' REGEXP ' + mysql.escape(this.pattern);
};

/******************************************************************************
 *****************************************************************************/
function LikeCondition(pattern) {
	this.pattern = pattern;
}
LikeCondition.prototype = new Operator();
LikeCondition.prototype.constructor = LikeCondition;

/**
 * get() implementation, this simply treats value as a string always, because other
 * possibilities don't make sense
 * @see Operator.get for parameter information
 */
LikeCondition.prototype.get = function(key, filter, options) {
	return filter.escapeKey(key, options) + ' LIKE ' + mysql.escape(this.pattern);
};

/******************************************************************************
 * Because I am super lazy when it comes to writing out code, all of the actual operators
 * are generally generated programmatically, because that requires the least amount of typing.
 *****************************************************************************/
// List of all operator functions that will be passed back to db-filters
var operators = {};

// Binary fixed operator generation
var binary_fixed_templates = [
	['$eq', '='], ['$neq', '!='],
	['$gt', '>'], ['$ge', '>='],
	['$lt', '<'], ['$le', '<=']];
binary_fixed_templates.forEach(function(v) {
	operators[v[0]] = function(val) {
		return new BinaryConditionFixed(v[1], val);
	};
});

// Binary free operator generation
var binary_free_templates = [
	['$eq2', '='], ['$neq2', '!='],
	['$gt2', '>'], ['$ge2', '>='],
	['$lt2', '<'], ['%le2', '<=']];
binary_free_templates.forEach(function(v) {
	operators[v[0]] = function(lval, rval) {
		return new BinaryConditionFree(v[1], lval, rval);
	};
});

// Array testing operators
operators.$in = function(v) { return new ArrayCondition(v, undefined); };
operators.$in2 = function(lval, arr) { return new ArrayCondition(arr, lval); };

// String pattern matching operators
operators.$regex = function(pattern) { return new RegexCondition(pattern); }
operators.$like = function(pattern) { return new LikeCondition(pattern); }

// Definition exports
module.exports.Operator = Operator;
module.exports.operators = operators;
