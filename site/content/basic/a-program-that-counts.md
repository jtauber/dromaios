# A program that counts

Let a program change a number for itself. Add one to the value already there,
repeat that change, and decide when the counting should finish.

## Add one to what is there

Load or resume BASIC using the instructions above, and begin at OK. If the
[previous lesson's ticket program](a-program-that-asks-again.md) is still
asking a question, answer 0 to finish it. We will make a different program,
so type NEW to clear the stored lines and variables.

First, try these commands without line numbers:

```basic-session
> NEW

OK
> LET N=1

OK
> PRINT N
 1

OK
> LET N=N+1

OK
> PRINT N
 2

OK
```

`LET N=N+1` is an instruction to change N. BASIC first works out the
expression on the right using the **old value** of N: 1 + 1 is 2. It then
stores that result as the **new value** of N. The old 1 has been replaced.

Here `=` means assignment. We are not claiming that a number is equal to
itself plus one. In `IF N=1 THEN ...`, the same symbol would test equality
without changing N.

**What will the same command do a second time?**

```basic-session
> LET N=N+1

OK
> PRINT N
 3

OK
```

The text of the instruction did not change, but the value it read did.
This time it calculated 2 + 1. We could also write `N=N+1` without LET;
we will keep LET here to make the assignment easy to spot.

[Try changing N ↑](#basic-terminal)

## Put the change inside a loop

Now let the stored program do the counting. Enter one numbered line at a
time, pressing Enter and waiting for its complete echo before the next:

```basic-session
> 10 LET N=1
> 20 PRINT N
> 30 LET N=N+1
> 40 IF N<=5 THEN 20
> 50 END
```

Line 10 chooses the starting value. Line 20 prints it, and line 30 adds one.
Line 40 decides whether we should return to PRINT with that new value.

The two characters `<=` mean **less than or equal to**. `N<=5` is true for
1, 2, 3, 4, and 5, and false for 6. Type both characters, with `<` first.
Unlike the assignment on line 30, this comparison does not change N.

Check the program with LIST:

```basic-session
> LIST

10 LET N=1
20 PRINT N
30 LET N=N+1
40 IF N<=5 THEN 20
50 END
OK
```

Then RUN it:

```basic-session
> RUN
 1
 2
 3
 4
 5

OK
```

There is no INPUT in this program. It produces all five numbers without
waiting for an answer from you.

[Run the counter ↑](#basic-terminal)

## Follow the last trip

Each trip through lines 20, 30, and 40 uses the value left by the previous
trip. The branch returns to line 20, so it passes over the assignment of 1
on line 10.

| N printed on line 20 | N after line 30 adds one | Is N <= 5? | Next line |
| --- | --- | --- | --- |
| 1 | 2 | Yes | 20 |
| 2 | 3 | Yes | 20 |
| 3 | 4 | Yes | 20 |
| 4 | 5 | Yes | 20 |
| 5 | 6 | No | 50 |

**What does N hold when we return to OK?** The last printed number and the
last stored value are different. Ask BASIC:

```basic-session
> PRINT N
 6

OK
```

The program printed 5, then changed N to 6. The comparison prevented another
trip to PRINT. END finished the run without erasing N.

Type RUN again:

```basic-session
> RUN
 1
 2
 3
 4
 5

OK
```

A new RUN starts at line 10, which gives N the value 1 again. Within each
run, the loop returns to line 20 and lets N keep growing.

## Choose an earlier stopping point

Change only line 40. **Predict which numbers will appear, and what N will
hold afterward.**

```basic-session
> 40 IF N<=3 THEN 20
> RUN
 1
 2
 3

OK
> PRINT N
 4

OK
```

The same start, print, and add instructions now stop after printing 3.
The value 4 fails the comparison, just as 6 did before.

Restore the limit of 5 for the next lesson:

```basic-session
> 40 IF N<=5 THEN 20
> RUN
 1
 2
 3
 4
 5

OK
```

Our loop has four jobs: choose a starting value, do something with it,
change it, and test whether to repeat. In
[the next lesson](counting-with-for-and-next.md), FOR and NEXT will express
this counting pattern directly.

[Change the stopping point ↑](#basic-terminal)
