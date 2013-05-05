db-filters
==========

Filtering library for systematic database query generation using Node.js

## Overview

The purpose of db-filters is to provide an abstraction layer between data and
the underlying database language. It provides a means for taking objects and
then generating queries (eventually, for multiple database engines and 
families) automatically. Traditionally, a database abstraction layer would
hide the API for interacting with the database behind a single API that can
easily convert calls to support MySQL, PostgreSQL, SQLite, etc. However, SQL
must still be written to send to these databasee, and it is not abstracted by
the API.

db-filters fills this gap by providing an abstraction to the query language
itself. In principle this allows for seamless migration between SQL and NoSQL
solutions, but for now its primary purpose is to generate SQL statements
programmatically with high consistency, safety (i.e. proper escaping), and
simplicity, as compared to writing SQL by hand.

The premise of filtering data for query generation moves the task of
translating object properties into database fields away from user code. Instead
central rules are specified that can decode all of the object properties. This
approach allows for simpler user code specifying what information is to be
retrieved from a database, and it gracefully handles a complex combination of
array types, optional values, and compound types that should always map to
multiple fields or require additional preprocessing before being placed into
an SQL query.

Trivia: This was originally a PHP library that I wrote, but the code was very
ugly. Now, a friend of mine is backporting the new Javascript version to
PHP 5.3.

## Usage


## Examples
