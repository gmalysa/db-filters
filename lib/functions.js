/**
 * Definition of operator functions that do not produce complete expressions--in general,
 * these can be used anywhere: in field definitions, inside where clauses, etc.
 *
 * (c) 2013, Greg Malysa <gmalysa@stanford.edu>
 * Permission to use governed by the terms of the MIT license. See LICENSE for details
 */

var mysql = require('mysql');
var op = require('./operator_base');

/*******************************************************************************
 * Base class for functions that take no arguments, such as RAND() or NOW().
 ******************************************************************************/
function NullaryFunction(name, fn) {
	op.Operator.call(this, name);
	this.fn = fn;
}
NullaryFunction.prototype = new op.Operator();
NullaryFunction.prototype.constructor = NullaryFunction;

/**
 * get() simply returns the name of the function with parenthesis, ignoring all
 * parameters
 * @see Operator.get()
 */
NullaryFunction.prototype.get = function(key, filter, options) {
	return this.fn + '()';
};

/**
 * getField() does the same thing, so just forward the call
 * @see Operator.getField()
 */
NullaryFunction.prototype.getField = function(filter, options) {
	return this.get();
}

/*******************************************************************************
 * Base class for functions that take a single parameter, which is either a field
 * or a value, depending on usage
 ******************************************************************************/
function UnaryFunction(name, fn, val) {
	op.Operator.call(this, name);
	this.fn = fn;
	this.value = val;
}
UnaryFunction.prototype = new op.Operator();
UnaryFunction.prototype.constructor = UnaryFunction;

/**
 * Implementation of get(), when this is used in a where clause, will apply
 * itself to the field given if no value was given, otherwise it will
 * wrap the value given.
 * @see Operator.get()
 */
UnaryFunction.prototype.get = function(key, filter, options) {
	if (this.value === undefined)
		return this.fn + '(' + filter.escapeKey(key, options) + ')';
	else
		return this.fn + '(' + this.eval(this.value, key, filter, options) + ')';
};

/**
 * Implementation of getField(), which requires that a value was supplied
 * @see Operator.getField()
 */
UnaryFunction.prototype.getField = function(filter, options) {
	return this.fn + '(' + filter.escapeKey(this.value, options) + ')';
};

/*******************************************************************************
 * Base class for functions that take two parameters, one of which is a field and
 * the other of which is a literal value. Also supports field passthrough when
 * used in a where clause
 ******************************************************************************/
function BinaryFunction(name, fn, field, val, order) {
	op.Operator.call(this, name);
	this.fn = fn;
	this.field = field;
	this.value = val;
	this.order = order;
}
BinaryFunction.prototype = new op.Operator();
BinaryFunction.prototype.constructor = BinaryFunction;

/**
 * Format a binary function, possibly evaluating key, value, or pre-specified
 * field according to our best guess for how to parse this.
 * @see Operator.get()
 */
BinaryFunction.prototype.get = function(key, filter, options) {
	var value = this.eval(this.value, key, filter, options);
	var field = filter.escapeKey((this.field === undefined) ? key : this.field, options);
	var args;
	
	if (this.order == 0)
		args = field + ', ' + value;
	else
		args = value + ', ' + field;
	
	return this.fn + '(' + args + ')';
};

/**
 * Does the same thing, but with a fixed field parameter specified, so it actually
 * just delegates back to get()
 * @see Operator.getField()
 */
BinaryFunction.prototype.getField = function(filter, options) {
	return this.get(this.field, filter, options);
};

/*******************************************************************************
 * Base class for binary infix operators, like + and *, which have a functional
 * form that is different from binary named functions
 ******************************************************************************/
function BinaryInfixOperator(name, fn, field, val) {
	op.Operator.call(this, name);
	this.fn = fn;
	this.field = field;
	this.value = val;
	this.require_group = true;
}
BinaryInfixOperator.prototype = new op.Operator();
BinaryInfixOperator.prototype.constructor = BinaryInfixOperator;

/**
 * Formats the operator expression just like for a function, except in infix notation
 * @see Operator.get()
 */
BinaryInfixOperator.prototype.get = function(key, filter, options) {
	var value = this.eval(this.value, key, filter, options);
	var field = filter.escapeKey((this.field === undefined) ? key : this.field, options);
	var args;

	return field + ' ' + this.fn + ' ' + value;
};

/**
 * Does the same thing, but requires that a field was specified at construction
 * time
 * @see Operator.getField()
 */
BinaryInfixOperator.prototype.getField = function(filter, options) {
	return this.get(this.field, filter, options);
};

/*******************************************************************************
 * Create complete list of operators/functions/etc. defined here and export it
 ******************************************************************************/
var operators = {};

// Nullary function list
var nullary_functions = [
	['$rand', 'RAND'], ['$now', 'NOW'],
	['$curdate', 'CURDATE'], ['$curtime', 'CURTIME'],
	['$utc_date', 'UTC_DATE'], ['$utc_time', '$UTC_TIME'],
	['$utc_timestamp', 'UTC_TIMESTAMP']];
nullary_functions.forEach(function(v) {
	operators[v[0]] = function() {
		return new NullaryFunction(v[0], v[1]);
	};
});

// Unary function information
var unary_functions = [
	['$count', 'COUNT'], ['$not', 'NOT'],
	// String functions
	['$length', 'LENGTH'], ['$char_length', 'CHAR_LENGTH'],
	['$trim', 'TRIM'], ['$ltrim', 'LTRIM'], ['$rtrim', 'RTRIM'],
	['$soundex', 'SOUNDEX'], ['$reverse', 'REVERSE'], ['$lcase', 'LOWER'],
	['$ucase', 'UPPER'],
	// Bitwise functions
	['$bitcount', 'BIT_COUNT'],
	// Math functions
	['$abs', 'ABS'], ['$acos', 'ACOS'], ['$asin', 'ASIN'], ['$atan', 'ATAN'],
	['$ceil', 'CEIL'], ['$cos', 'COS'], ['$cot', 'COT'], ['$crc32', 'CRC32'],
	['$degrees', 'DEGREES'], ['$exp', 'EXP'], ['$floor', 'FLOOR'],
	['$ln', 'LN'], ['$log10', 'LOG10'], ['$log2', 'LOG2'],
	['$radians', 'RADIANS'], ['$round', 'ROUND'], ['$sign', 'SIGN'],
	['$sin', 'SIN'], ['$sqrt', 'SQRT'], ['$tan', 'TAN'],
	// "Miscellaneous" functions
	['$md5', 'MD5'], ['$sha1', 'SHA1'], ['$compress', 'COMPRESS'],
	['$uncompress', 'UNCOMPRESS'], ['$encrypt', 'ENCRYPT'],
	['$inet_aton', 'INET_ATON'], ['$inet_ntoa', 'INET_NTOA'],
	];
unary_functions.forEach(function(v) {
	operators[v[0]] = function(value) {
		return new UnaryFunction(v[0], v[1], value);
	};
});

// Binary function information
var binary_functions = [
	// String functions
	['$left', 'LEFT', 0], ['$right', 'RIGHT', 0], ['$repeat', 'REPEAT', 0],
	['$concat', 'CONCAT', 0],
	// Math functions
	['$format', 'FORMAT', 0], ['$atan2', 'ATAN2', 0],
	['$pow', 'POW', 0], ['$truncate', 'TRUNCATE', 0], ['$round_to', 'ROUND', 0],
	// "Miscellaneous functions"
	['$aes_encrypt', 'AES_ENCRYPT', 0], ['$aes_decrypt', 'AES_DECRYPT', 0],
	['$des_encrypte', 'DES_ENCRYPT', 0], ['$des_decrypt', 'DES_DECRYPT', 0],
	['$encode', 'ENCODE', 0], ['$decode', 'DECODE', 0]
	];
binary_functions.forEach(function(v) {
	operators[v[0]] = function(a1, a2) {
		if (arguments.length == 1)
			return new BinaryFunction(v[0], v[1], undefined, a1, v[2]);
		else
			return new BinaryFunction(v[0], v[1], a1, a2, v[2]);
	};
});

// Binary infix function information
var binary_infix = [
	['$band', '&'], ['$bor', '|'], ['$bxor', '^'],
	['$lshift', '<<'], ['$rshift', '>>'],
	['$add', '+'], ['$sub', '-'], ['$mult', '*'], ['$div', '/'],
	['$mod', '%']];
binary_infix.forEach(function(v) {
	operators[v[0]] = function(a1, a2) {
		if (arguments.length == 1)
			return new BinaryInfixOperator(v[0], v[1], undefined, a1);
		else
			return new BinaryInfixOperator(v[0], v[1], a1, a2);
	};
});

// Finally, export operators from the module, but no need for classes
module.exports.operators = operators;
