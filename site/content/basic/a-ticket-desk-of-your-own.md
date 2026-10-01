# A ticket desk of your own

Bring the ideas from this BASIC path together in a small program. Plan a
ticket desk, check it against a set of examples, and change its price without
changing how it asks questions or keeps a total.

## Start with what the program should do

Load or resume BASIC using the instructions above, and begin at OK. This is
the final project in our introductory BASIC path. It uses commands we have
already met; the task is to decide how they fit together.

We want a ticket desk with these rules:

1. Each ticket costs 2 pounds.
2. Ask how many tickets someone wants, print that purchase's cost, and ask
   again for the next purchase.
3. For a negative answer, explain the problem and ask again without changing
   the total.
4. An answer of zero finishes the run and prints the total cost of all its
   purchases. Finishing before any purchase should give a total of zero.
5. Another RUN starts a fresh total.

As in the earlier ticket programs, enter small whole numbers. Our negative
check does not reject positive fractions; we are keeping the same limited
input rules for this project.

**Try making a plan before reading the solution.** Which instructions run
once at the start? Which ones repeat? Where does each of the three kinds of
answer go? You can sketch those paths on paper before choosing line numbers.

The [repeating question](a-program-that-asks-again.md) and
[running total](a-program-that-keeps-a-total.md) lessons can help. We need an
input loop here: we do not know how many purchases someone will make, so a
FOR loop with a fixed number of trips would not fit these rules.

## Give each value a job

Here is one plan. Choose separate names for the values we need:

| Name | Job | When it changes |
| --- | --- | --- |
| P | Price of one ticket, in pounds. | Set once at the start. |
| N | Number of tickets in this purchase. | Replaced by each INPUT. |
| C | Cost of this purchase, in pounds. | Calculated for each positive answer. |
| T | Total cost of accepted purchases, in pounds. | Starts at zero; add each new C. |

Using P for the price means we can change it in one place. Calculating
`C=N*P` once lets us both print C and add it to T. These are ordinary
variables, just like N and T in the earlier lessons.

The plan is: set P and T, ask for N, then choose a path. A negative N gets
an explanation and another question. Zero goes to the final total. A
positive N gets a calculation, a printed cost, and an addition to T before
the next question.

## Build a reference version

You can try your own version first. The conversations below check this
reference version; your wording and line numbers may differ, but the rules
and calculated answers should agree.

At OK, type NEW to remove the previous lesson's program or your trial
version. Then enter these lines one at a time, pressing Enter and waiting
for each complete echo before the next:

```basic-session
> NEW

OK
> 5 LET P=2
> 10 LET T=0
> 20 PRINT "HOW MANY TICKETS (0 TO FINISH)"
> 30 INPUT N
> 40 IF N<0 THEN 120
> 50 IF N=0 THEN 100
> 60 LET C=N*P
> 70 PRINT "COST POUNDS"
> 75 PRINT C
> 80 LET T=T+C
> 90 GOTO 20
> 100 PRINT "TOTAL POUNDS"
> 110 PRINT T
> 115 END
> 120 PRINT "PLEASE USE ZERO OR MORE"
> 130 GOTO 20
```

Check the stored program with LIST:

```basic-session
> LIST

5 LET P=2
10 LET T=0
20 PRINT "HOW MANY TICKETS (0 TO FINISH)"
30 INPUT N
40 IF N<0 THEN 120
50 IF N=0 THEN 100
60 LET C=N*P
70 PRINT "COST POUNDS"
75 PRINT C
80 LET T=T+C
90 GOTO 20
100 PRINT "TOTAL POUNDS"
110 PRINT T
115 END
120 PRINT "PLEASE USE ZERO OR MORE"
130 GOTO 20
OK
```

**Follow the paths before RUN.** Both GOTOs return to line 20, passing over
the starting assignments. The negative and zero checks come before the
calculation and addition. END on line 115 keeps the finished run from
continuing into the negative-answer message.

[Build the ticket desk ↑](#basic-terminal)

## Check the requirements

Work out the results independently before asking BASIC. At 2 pounds per
ticket, these four runs should behave as follows:

| Answers, in order | Purchase costs | Final total | What this checks |
| --- | --- | --- | --- |
| 3, 1, 0 | 6, then 2 | 8 | Several purchases add together. |
| 2, -1, 1, 0 | 4, then 2 | 6 | Rejection preserves an earlier purchase. |
| 0 | None | 0 | Finishing immediately works. |
| 2, 0 | 4 | 4 | A later RUN has its own total. |

Start with the first row. Type each answer only when `?` appears:

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 3
COST POUNDS
 6
HOW MANY TICKETS (0 TO FINISH)
?
> 1
COST POUNDS
 2
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 8

OK
```

Now try a negative answer between two purchases. There should be no cost
printed for -1, and it must not subtract from the total:

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 2
COST POUNDS
 4
HOW MANY TICKETS (0 TO FINISH)
?
> -1
PLEASE USE ZERO OR MORE
HOW MANY TICKETS (0 TO FINISH)
?
> 1
COST POUNDS
 2
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 6

OK
```

The first run ended with 8 pounds; this one ends with its own 6 pounds.
Only its accepted purchases contributed to that total.

Check the last two rows as well:

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 0

OK
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 2
COST POUNDS
 4
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 4

OK
```

Each zero answer reaches the total and END without another question.
At OK, the stored program is still available for another RUN.

[Check all four runs ↑](#basic-terminal)

## Change the price in one place

Suppose each ticket should now cost 3 pounds. **Which stored line needs to
change?** Replace line 5:

```basic-session
> 5 LET P=3
```

The line number matters: this changes the assignment that RUN will execute.
An immediate `LET P=3` would not change the stored line, and the next RUN
would still execute its old assignment of 2.

Repeat the first set of answers. Three tickets should now cost 9 pounds,
one should cost 3 pounds, and the total should be 12 pounds:

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 3
COST POUNDS
 9
HOW MANY TICKETS (0 TO FINISH)
?
> 1
COST POUNDS
 3
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 12

OK
```

The calculation still reads `C=N*P`. It uses the new value of P, and both
the printed cost and the total use the resulting C. There was no second
copy of the ticket price to find and change.

Changing the price should not change the other rules. Check rejection and
an empty total together:

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> -1
PLEASE USE ZERO OR MORE
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 0

OK
```

[Try the new price ↑](#basic-terminal)

## If your results differ

Use the method from [the debugging lesson](finding-and-fixing-a-mistake.md):
pick one short failing conversation, predict the intermediate values, and
use LIST and temporary PRINT lines to follow what happens.

- If a purchase's cost is wrong, inspect N and P before line 60, then C
  after it. Multiplication uses their current values.
- If the costs are right but the total is wrong, inspect T after line 80.
  It must keep the old total and add C. Check that neither GOTO returns to
  line 10 and clears it before the next question.
- If a rejected answer changes the total, follow its branch. That path
  should return to the question without reaching line 80.

For example, line 85 is a place to put a temporary `PRINT T` after each
addition. Remove any diagnostic lines when you finish, then repeat the
checks. Their extra output will not appear in the reference conversations.

## Finish the introductory path

You can now turn a small set of rules into a stored program, predict its
answers, change it, and investigate a mistake. Before moving on, explain:

- Why do N and C change for each purchase while T keeps a running total?
- Why does zero finish, while a negative answer asks again?
- Why do the GOTOs go to line 20 rather than line 10?
- Why does END finish our program while the Altair's processor keeps running?

Use the earlier lessons whenever one of those steps is unclear. You do not
need to memorize the line numbers or every command to reason about a program.

This completes our first BASIC learning path. Your instructions ran inside
the original interpreter, which itself ran as 8080 instructions on the
emulated Altair.
